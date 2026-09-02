from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from langgraph.types import Command, GraphOutput

from job_helper_agent.config import AgentConfig
from job_helper_agent.database import AgentRun, sha256_json
from job_helper_agent.models import ResumeRequest, RunCreateRequest
from job_helper_agent.repository import AgentRepository, RunConflict


class RecoverableAgentService:
    def __init__(self, *, config: AgentConfig, graph, repository: AgentRepository):
        self._config = config
        self._graph = graph
        self._repository = repository
        self._thread_locks: dict[str, asyncio.Lock] = {}
        self._thread_locks_guard = asyncio.Lock()

    @staticmethod
    def _graph_config(thread_id: str) -> dict[str, dict[str, str]]:
        return {"configurable": {"thread_id": thread_id}}

    @asynccontextmanager
    async def _thread_lock(self, thread_id: str):
        async with self._thread_locks_guard:
            lock = self._thread_locks.setdefault(thread_id, asyncio.Lock())
        async with lock:
            yield

    async def create_run(self, request: RunCreateRequest) -> AgentRun:
        input_json = request.model_dump(mode="json")
        run, _ = await self._repository.create_or_get_run(
            run_id=str(uuid4()),
            thread_id=str(uuid4()),
            subject_ref=self._config.subject_ref,
            source_job_ref=request.source_job_ref,
            request_id=str(request.request_id),
            fingerprint=sha256_json(input_json),
            input_json=input_json,
            policy_version=self._config.policy_version,
            graph_version=self._config.graph_version,
        )
        async with self._thread_lock(run.thread_id):
            run = await self._repository.get_run(run.run_id, self._config.subject_ref)
            return await self._reconcile_or_drive_locked(run)

    async def resume_run(self, run_id: str, request: ResumeRequest) -> AgentRun:
        run = await self._repository.get_run(run_id, self._config.subject_ref)
        async with self._thread_lock(run.thread_id):
            run = await self._repository.get_run(run_id, self._config.subject_ref)
            if run.status == "FAILED":
                return run
            if run.status == "COMPLETED":
                return await self._repository.finalize_approval(
                    run_id=run.run_id,
                    subject_ref=self._config.subject_ref,
                    lease_token=None,
                    proposal_id=str(request.proposal_id),
                    interrupt_id=request.interrupt_id,
                    preview_hash=request.preview_hash,
                    decision_request_id=str(request.decision_request_id),
                    decision=request.decision.value,
                    reason=request.reason,
                )
            snapshot = await self._checkpoint_or_fail(run)
            values = dict(snapshot.values or {})
            interrupts = tuple(snapshot.interrupts or ())
            if interrupts:
                run = await self._repository.mark_waiting(
                    run_id=run.run_id,
                    subject_ref=self._config.subject_ref,
                    decision=str(values["decision"]),
                    proposal=values["proposal"],
                    interrupt_id=str(interrupts[0].id),
                )
                return await self._resume_interrupt_locked(run, request, str(interrupts[0].id))
            if snapshot.next:
                return await self._continue_intermediate_locked(run, request=request)
            if values.get("approval_decision"):
                self._assert_approval_facts(request, run, values)
                return await self._finalize_from_graph(run, values, lease_token=None)
            if not values:
                await self._repository.fail_run(
                    run.run_id,
                    self._config.subject_ref,
                    "checkpoint_missing_or_not_interruptible",
                )
                raise RunConflict("run checkpoint is missing or cannot be resumed")
            raise RunConflict("run checkpoint is terminal without approval facts")

    async def reconcile_run(self, run: AgentRun) -> AgentRun:
        async with self._thread_lock(run.thread_id):
            current = await self._repository.get_run(run.run_id, self._config.subject_ref)
            return await self._reconcile_or_drive_locked(current)

    async def _reconcile_or_drive_locked(self, run: AgentRun) -> AgentRun:
        if run.status in {"COMPLETED", "FAILED"}:
            return run
        snapshot = await self._checkpoint_or_fail(run)
        values = dict(snapshot.values or {})
        interrupts = tuple(snapshot.interrupts or ())
        if interrupts:
            return await self._repository.mark_waiting(
                run_id=run.run_id,
                subject_ref=self._config.subject_ref,
                decision=str(values["decision"]),
                proposal=values["proposal"],
                interrupt_id=str(interrupts[0].id),
            )
        if snapshot.next:
            return await self._continue_intermediate_locked(run, request=None)
        if values.get("approval_decision"):
            return await self._finalize_from_graph(run, values, lease_token=None)
        if values.get("decision") and not snapshot.next and not interrupts:
            return await self._repository.complete_without_action(
                run_id=run.run_id,
                subject_ref=self._config.subject_ref,
                decision=str(values["decision"]),
                result={
                    "outcome": "NO_ACTION",
                    "decision": str(values["decision"]),
                    "reasons": values.get("reasons", []),
                },
            )
        if run.status in {"WAITING_APPROVAL"}:
            return await self._repository.fail_run(
                run.run_id, self._config.subject_ref, "checkpoint_missing"
            )
        return await self._drive_initial_locked(run, continue_existing=False)

    async def _drive_initial_locked(
        self, run: AgentRun, *, continue_existing: bool
    ) -> AgentRun:
        if self._lease_active(run.execution_token, run.execution_lease_until):
            return run
        run, execution_token = await self._repository.claim_execution(
            run.run_id,
            self._config.subject_ref,
            self._config.resume_lease_seconds,
        )
        if execution_token is None:
            return run
        output: GraphOutput = await self._with_lease_renewal(
            operation=self._graph.ainvoke(
                None if continue_existing else self._initial_state(run),
                self._graph_config(run.thread_id),
                version="v2",
            ),
            renew=lambda: self._repository.renew_execution_lease(
                run.run_id,
                self._config.subject_ref,
                execution_token,
                self._config.resume_lease_seconds,
            ),
        )
        post_snapshot = await self._checkpoint_or_fail(run)
        if post_snapshot.next and not post_snapshot.interrupts:
            return await self._repository.get_run(run.run_id, self._config.subject_ref)
        return await self._persist_initial_output(run, output, execution_token)

    async def _continue_intermediate_locked(
        self, run: AgentRun, *, request: ResumeRequest | None
    ) -> AgentRun:
        if run.status == "RUNNING":
            return await self._drive_initial_locked(run, continue_existing=True)
        if run.status != "WAITING_APPROVAL":
            return await self._repository.fail_run(
                run.run_id, self._config.subject_ref, "checkpoint_status_mismatch"
            )
        if self._lease_active(run.resume_token, run.resume_lease_until):
            return run
        lease_token = await self._repository.acquire_resume_lease(
            run_id=run.run_id,
            subject_ref=self._config.subject_ref,
            lease_seconds=self._config.resume_lease_seconds,
        )
        try:
            output: GraphOutput = await self._with_lease_renewal(
                operation=self._graph.ainvoke(
                    None,
                    self._graph_config(run.thread_id),
                    version="v2",
                ),
                renew=lambda: self._repository.renew_resume_lease(
                    run.run_id,
                    self._config.subject_ref,
                    lease_token,
                    self._config.resume_lease_seconds,
                ),
            )
            post_snapshot = await self._checkpoint_or_fail(run)
            if post_snapshot.next or post_snapshot.interrupts:
                return await self._repository.get_run(run.run_id, self._config.subject_ref)
            values = dict(output.value or post_snapshot.values or {})
            if request is not None:
                self._assert_approval_facts(request, run, values)
            return await self._finalize_from_graph(run, values, lease_token=lease_token)
        except Exception:
            await self._repository.release_resume_lease(
                run.run_id, self._config.subject_ref, lease_token
            )
            raise

    async def _resume_interrupt_locked(
        self, run: AgentRun, request: ResumeRequest, interrupt_id: str
    ) -> AgentRun:
        self._validate_resume_request(run, request, interrupt_id)
        lease_token = await self._repository.acquire_resume_lease(
            run_id=run.run_id,
            subject_ref=self._config.subject_ref,
            lease_seconds=self._config.resume_lease_seconds,
        )
        resume_value = {
            "decision": request.decision.value,
            "decision_request_id": str(request.decision_request_id),
            "reason": request.reason,
        }
        try:
            output: GraphOutput = await self._with_lease_renewal(
                operation=self._graph.ainvoke(
                    Command(resume={request.interrupt_id: resume_value}),
                    self._graph_config(run.thread_id),
                    version="v2",
                ),
                renew=lambda: self._repository.renew_resume_lease(
                    run.run_id,
                    self._config.subject_ref,
                    lease_token,
                    self._config.resume_lease_seconds,
                ),
            )
            post_snapshot = await self._checkpoint_or_fail(run)
            if post_snapshot.next or post_snapshot.interrupts:
                return await self._repository.get_run(run.run_id, self._config.subject_ref)
            values = dict(output.value or post_snapshot.values or {})
            self._assert_approval_facts(request, run, values)
            return await self._finalize_from_graph(run, values, lease_token=lease_token)
        except Exception:
            await self._repository.release_resume_lease(
                run.run_id, self._config.subject_ref, lease_token
            )
            raise

    @staticmethod
    def _lease_active(token: str | None, lease_until: datetime | None) -> bool:
        return bool(
            token
            and lease_until
            and lease_until > datetime.now(UTC).replace(tzinfo=None)
        )

    async def _checkpoint_or_fail(self, run: AgentRun):
        try:
            return await self._graph.aget_state(self._graph_config(run.thread_id))
        except Exception as error:
            if run.status not in {"COMPLETED", "FAILED"}:
                await self._repository.fail_run(
                    run.run_id,
                    self._config.subject_ref,
                    "checkpoint_unreadable",
                )
            raise RunConflict("run checkpoint is unreadable") from error

    def _initial_state(self, run: AgentRun) -> dict[str, Any]:
        request = dict(run.input_json)
        return {
            **request,
            "run_id": run.run_id,
            "thread_id": run.thread_id,
            "subject_ref": self._config.subject_ref,
            "request_id": run.request_id,
            "policy_version": run.policy_version,
            "graph_version": run.graph_version,
        }

    async def _persist_initial_output(
        self, run: AgentRun, output: GraphOutput, execution_token: str
    ) -> AgentRun:
        values = dict(output.value or {})
        if output.interrupts:
            return await self._repository.mark_waiting(
                run_id=run.run_id,
                subject_ref=self._config.subject_ref,
                decision=str(values["decision"]),
                proposal=values["proposal"],
                interrupt_id=str(output.interrupts[0].id),
                execution_token=execution_token,
            )
        return await self._repository.complete_without_action(
            run_id=run.run_id,
            subject_ref=self._config.subject_ref,
            decision=str(values["decision"]),
            result={
                "outcome": "NO_ACTION",
                "decision": str(values["decision"]),
                "reasons": values.get("reasons", []),
            },
            execution_token=execution_token,
        )

    async def _finalize_from_graph(
        self, run: AgentRun, values: dict[str, Any], lease_token: str | None
    ) -> AgentRun:
        return await self._repository.finalize_approval(
            run_id=run.run_id,
            subject_ref=self._config.subject_ref,
            lease_token=lease_token,
            proposal_id=str(values["proposal_id"]),
            interrupt_id=str(run.interrupt_id),
            preview_hash=str(values["preview_hash"]),
            decision_request_id=str(values["decision_request_id"]),
            decision=str(values["approval_decision"]),
            reason=values.get("approval_reason"),
        )

    @staticmethod
    def _validate_resume_request(run: AgentRun, request: ResumeRequest, interrupt_id: str) -> None:
        if (
            run.proposal_id != str(request.proposal_id)
            or interrupt_id != request.interrupt_id
            or run.interrupt_id != request.interrupt_id
            or run.preview_hash != request.preview_hash
        ):
            raise RunConflict("approval does not match the server-side interrupt")

    @staticmethod
    def _assert_approval_facts(
        request: ResumeRequest, run: AgentRun, values: dict[str, Any]
    ) -> None:
        if (
            str(values.get("proposal_id")) != str(request.proposal_id)
            or str(values.get("preview_hash")) != request.preview_hash
            or str(values.get("decision_request_id")) != str(request.decision_request_id)
            or str(values.get("approval_decision")) != request.decision.value
            or values.get("approval_reason") != request.reason
        ):
            raise RunConflict("client approval conflicts with checkpoint terminal facts")
        if run.interrupt_id != request.interrupt_id:
            raise RunConflict("client interrupt id conflicts with server facts")

    async def _with_lease_renewal(
        self,
        *,
        operation: Awaitable[GraphOutput],
        renew: Callable[[], Awaitable[bool]],
    ) -> GraphOutput:
        stop = asyncio.Event()
        lost = asyncio.Event()

        async def renew_loop() -> None:
            interval = max(0.25, self._config.resume_lease_seconds / 3)
            while True:
                try:
                    await asyncio.wait_for(stop.wait(), timeout=interval)
                    return
                except TimeoutError:
                    if not await renew():
                        lost.set()
                        return

        task = asyncio.create_task(renew_loop())
        try:
            result = await operation
        finally:
            stop.set()
            await task
        if lost.is_set():
            raise RunConflict("execution lease was lost before graph completion")
        return result
