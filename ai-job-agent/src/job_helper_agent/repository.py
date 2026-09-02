from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from sqlalchemy import or_, select, update
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from job_helper_agent.database import (
    AgentAction,
    AgentApproval,
    AgentEvent,
    AgentRun,
    action_idempotency_key,
    sha256_json,
)


class RepositoryError(RuntimeError):
    pass


class RunNotFound(RepositoryError):
    pass


class RunConflict(RepositoryError):
    pass


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class AgentRepository:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._sessions = session_factory

    async def create_or_get_run(
        self,
        *,
        run_id: str,
        thread_id: str,
        subject_ref: str,
        source_job_ref: str,
        request_id: str,
        fingerprint: str,
        input_json: dict[str, Any],
        policy_version: str,
        graph_version: str,
    ) -> tuple[AgentRun, bool]:
        now = _utcnow()
        async with self._sessions.begin() as session:
            statement = mysql_insert(AgentRun).values(
                run_id=run_id,
                thread_id=thread_id,
                subject_ref=subject_ref,
                request_id=request_id,
                request_fingerprint=fingerprint,
                input_json=input_json,
                status="CREATED",
                policy_version=policy_version,
                graph_version=graph_version,
                last_event_seq=0,
                row_version=0,
                created_at=now,
                updated_at=now,
            ).prefix_with("IGNORE")
            result = await session.execute(statement)
            created = result.rowcount == 1
            run = await session.scalar(
                select(AgentRun)
                .where(
                    AgentRun.subject_ref == subject_ref,
                    AgentRun.request_id == request_id,
                )
                .with_for_update()
            )
            if run is None:
                raise RepositoryError("run insert did not produce a readable row")
            if run.request_fingerprint != fingerprint:
                raise RunConflict("request_id was already used with a different payload")
            if created:
                await self._append_event_locked(
                    session,
                    run,
                    event_type="RUN_CREATED",
                    dedupe_key=f"run:{run.run_id}:created",
                    payload={"source_job_ref": source_job_ref},
                )
            return run, created

    async def get_run(self, run_id: str, subject_ref: str) -> AgentRun:
        async with self._sessions() as session:
            run = await session.scalar(
                select(AgentRun).where(
                    AgentRun.run_id == run_id,
                    AgentRun.subject_ref == subject_ref,
                )
            )
            if run is None:
                raise RunNotFound("run does not exist")
            return run

    async def claim_execution(
        self, run_id: str, subject_ref: str, lease_seconds: int
    ) -> tuple[AgentRun, str | None]:
        async with self._sessions.begin() as session:
            run = await self._lock_run(session, run_id, subject_ref)
            now = _utcnow()
            claimable = run.status == "CREATED" or (
                run.status == "RUNNING"
                and (run.execution_lease_until is None or run.execution_lease_until < now)
            )
            token = str(uuid4()) if claimable else None
            if claimable:
                run.status = "RUNNING"
                run.execution_token = token
                run.execution_lease_until = now + timedelta(seconds=lease_seconds)
                run.updated_at = now
                run.row_version += 1
                await self._append_event_locked(
                    session,
                    run,
                    event_type="RUN_STARTED",
                    dedupe_key=f"run:{run_id}:execution:{token}",
                    payload={"recovered": run.last_event_seq > 1},
                )
            return run, token

    async def renew_execution_lease(
        self, run_id: str, subject_ref: str, token: str, lease_seconds: int
    ) -> bool:
        async with self._sessions.begin() as session:
            result = await session.execute(
                update(AgentRun)
                .where(
                    AgentRun.run_id == run_id,
                    AgentRun.subject_ref == subject_ref,
                    AgentRun.status == "RUNNING",
                    AgentRun.execution_token == token,
                )
                .values(execution_lease_until=_utcnow() + timedelta(seconds=lease_seconds))
            )
            return result.rowcount == 1

    async def mark_waiting(
        self,
        *,
        run_id: str,
        subject_ref: str,
        decision: str,
        proposal: dict[str, Any],
        interrupt_id: str,
        execution_token: str | None = None,
    ) -> AgentRun:
        async with self._sessions.begin() as session:
            run = await self._lock_run(session, run_id, subject_ref)
            if run.status == "COMPLETED":
                return run
            if run.status == "FAILED":
                raise RunConflict("failed run is terminal")
            if run.status not in {"RUNNING", "WAITING_APPROVAL"}:
                raise RunConflict("run cannot transition to waiting approval")
            if execution_token is not None and run.execution_token != execution_token:
                raise RunConflict("create execution lease is no longer owned by this request")
            run.status = "WAITING_APPROVAL"
            run.decision = decision
            run.proposal_id = str(proposal["proposal_id"])
            run.proposal_json = proposal
            run.preview_hash = str(proposal["preview_hash"])
            run.interrupt_id = interrupt_id
            run.execution_token = None
            run.execution_lease_until = None
            run.updated_at = _utcnow()
            run.row_version += 1
            await self._append_event_locked(
                session,
                run,
                event_type="APPROVAL_REQUESTED",
                dedupe_key=f"run:{run_id}:proposal:{run.proposal_id}",
                payload={
                    "proposal_id": run.proposal_id,
                    "preview_hash": run.preview_hash,
                    "interrupt_id": interrupt_id,
                },
            )
            return run

    async def complete_without_action(
        self,
        *,
        run_id: str,
        subject_ref: str,
        decision: str,
        result: dict[str, Any],
        execution_token: str | None = None,
    ) -> AgentRun:
        async with self._sessions.begin() as session:
            run = await self._lock_run(session, run_id, subject_ref)
            if run.status == "COMPLETED":
                return run
            if run.status == "FAILED":
                raise RunConflict("failed run is terminal")
            if run.status != "RUNNING":
                raise RunConflict("run cannot complete from its current status")
            if execution_token is not None and run.execution_token != execution_token:
                raise RunConflict("create execution lease is no longer owned by this request")
            now = _utcnow()
            run.status = "COMPLETED"
            run.decision = decision
            run.result_json = result
            run.resume_token = None
            run.resume_lease_until = None
            run.execution_token = None
            run.execution_lease_until = None
            run.updated_at = now
            run.completed_at = now
            run.row_version += 1
            await self._append_event_locked(
                session,
                run,
                event_type="RUN_COMPLETED",
                dedupe_key=f"run:{run_id}:completed",
                payload={"decision": decision, "action_created": False},
            )
            return run

    async def acquire_resume_lease(
        self,
        *,
        run_id: str,
        subject_ref: str,
        lease_seconds: int,
    ) -> str:
        now = _utcnow()
        lease_until = now + timedelta(seconds=lease_seconds)
        token = str(uuid4())
        async with self._sessions.begin() as session:
            result = await session.execute(
                update(AgentRun)
                .where(
                    AgentRun.run_id == run_id,
                    AgentRun.subject_ref == subject_ref,
                    AgentRun.status == "WAITING_APPROVAL",
                    or_(
                        AgentRun.resume_token.is_(None),
                        AgentRun.resume_lease_until.is_(None),
                        AgentRun.resume_lease_until < now,
                    ),
                )
                .values(
                    resume_token=token,
                    resume_lease_until=lease_until,
                    updated_at=now,
                    row_version=AgentRun.row_version + 1,
                )
            )
            if result.rowcount != 1:
                run = await session.scalar(
                    select(AgentRun).where(
                        AgentRun.run_id == run_id,
                        AgentRun.subject_ref == subject_ref,
                    )
                )
                if run is None:
                    raise RunNotFound("run does not exist")
                if run.status == "COMPLETED":
                    raise RunConflict("run is already completed")
                raise RunConflict("another resume request holds the lease")
        return token

    async def release_resume_lease(self, run_id: str, subject_ref: str, token: str) -> None:
        async with self._sessions.begin() as session:
            await session.execute(
                update(AgentRun)
                .where(
                    AgentRun.run_id == run_id,
                    AgentRun.subject_ref == subject_ref,
                    AgentRun.resume_token == token,
                )
                .values(resume_token=None, resume_lease_until=None, updated_at=_utcnow())
            )

    async def renew_resume_lease(
        self, run_id: str, subject_ref: str, token: str, lease_seconds: int
    ) -> bool:
        async with self._sessions.begin() as session:
            result = await session.execute(
                update(AgentRun)
                .where(
                    AgentRun.run_id == run_id,
                    AgentRun.subject_ref == subject_ref,
                    AgentRun.status == "WAITING_APPROVAL",
                    AgentRun.resume_token == token,
                )
                .values(resume_lease_until=_utcnow() + timedelta(seconds=lease_seconds))
            )
            return result.rowcount == 1

    async def fail_run(self, run_id: str, subject_ref: str, reason: str) -> AgentRun:
        async with self._sessions.begin() as session:
            run = await self._lock_run(session, run_id, subject_ref)
            if run.status in {"COMPLETED", "FAILED"}:
                return run
            now = _utcnow()
            run.status = "FAILED"
            run.result_json = {"outcome": "FAILED", "reason": reason}
            run.resume_token = None
            run.resume_lease_until = None
            run.execution_token = None
            run.execution_lease_until = None
            run.updated_at = now
            run.completed_at = now
            run.row_version += 1
            await self._append_event_locked(
                session,
                run,
                event_type="RUN_FAILED",
                dedupe_key=f"run:{run_id}:failed",
                payload={"reason": reason},
            )
            return run

    async def finalize_approval(
        self,
        *,
        run_id: str,
        subject_ref: str,
        lease_token: str | None,
        proposal_id: str,
        interrupt_id: str,
        preview_hash: str,
        decision_request_id: str,
        decision: str,
        reason: str | None,
    ) -> AgentRun:
        now = _utcnow()
        async with self._sessions.begin() as session:
            run = await self._lock_run(session, run_id, subject_ref)
            existing = await session.scalar(
                select(AgentApproval).where(
                    AgentApproval.subject_ref == subject_ref,
                    AgentApproval.decision_request_id == decision_request_id,
                )
            )
            if run.status == "COMPLETED":
                if existing is None or not self._approval_matches(
                    existing,
                    run_id=run_id,
                    proposal_id=proposal_id,
                    interrupt_id=interrupt_id,
                    preview_hash=preview_hash,
                    decision=decision,
                    reason=reason,
                ):
                    raise RunConflict("completed run cannot accept a different approval")
                return run
            if run.status == "FAILED":
                raise RunConflict("failed run is terminal")
            if run.status != "WAITING_APPROVAL":
                raise RunConflict("run cannot finalize approval from its current status")
            if lease_token is not None and run.resume_token != lease_token:
                raise RunConflict("resume lease is no longer owned by this request")
            self._validate_proposal(run, proposal_id, interrupt_id, preview_hash)

            approval_id = str(uuid4())
            inserted = await session.execute(
                mysql_insert(AgentApproval)
                .values(
                    approval_id=approval_id,
                    run_id=run_id,
                    proposal_id=proposal_id,
                    interrupt_id=interrupt_id,
                    subject_ref=subject_ref,
                    decision_request_id=decision_request_id,
                    decision=decision,
                    preview_hash=preview_hash,
                    reason=reason,
                    decided_at=now,
                )
                .prefix_with("IGNORE")
            )
            if inserted.rowcount != 1:
                existing = await session.scalar(
                    select(AgentApproval).where(
                        AgentApproval.subject_ref == subject_ref,
                        AgentApproval.decision_request_id == decision_request_id,
                    )
                )
                if existing is None or not self._approval_matches(
                    existing,
                    run_id=run_id,
                    proposal_id=proposal_id,
                    interrupt_id=interrupt_id,
                    preview_hash=preview_hash,
                    decision=decision,
                    reason=reason,
                ):
                    raise RunConflict("decision_request_id conflicts with an existing approval")
                approval_id = existing.approval_id

            await self._append_event_locked(
                session,
                run,
                event_type="APPROVAL_APPROVED" if decision == "APPROVE" else "APPROVAL_REJECTED",
                dedupe_key=f"approval:{approval_id}:decision",
                payload={"approval_id": approval_id, "decision": decision},
            )

            action_created = False
            if decision == "APPROVE":
                target_ref = str((run.proposal_json or {})["target_ref"])
                payload = {
                    "action_kind": "CONTACT_JOB",
                    "target_ref": target_ref,
                }
                idem = action_idempotency_key(subject_ref, target_ref)
                action_insert = await session.execute(
                    mysql_insert(AgentAction)
                    .values(
                        action_id=str(uuid4()),
                        run_id=run_id,
                        approval_id=approval_id,
                        subject_ref=subject_ref,
                        action_kind="CONTACT_JOB",
                        target_ref=target_ref,
                        payload_json=payload,
                        payload_hash=sha256_json(payload),
                        preview_hash=preview_hash,
                        idempotency_key=idem,
                        status="QUEUED",
                        available_at=now,
                        created_at=now,
                        updated_at=now,
                    )
                    .prefix_with("IGNORE")
                )
                action_created = action_insert.rowcount == 1
                if not action_created:
                    existing_action = await session.scalar(
                        select(AgentAction).where(AgentAction.idempotency_key == idem)
                    )
                    expected_payload_hash = sha256_json(payload)
                    if (
                        existing_action is None
                        or existing_action.subject_ref != subject_ref
                        or existing_action.action_kind != "CONTACT_JOB"
                        or existing_action.target_ref != target_ref
                        or existing_action.payload_json != payload
                        or existing_action.payload_hash != expected_payload_hash
                        or existing_action.preview_hash != preview_hash
                        or existing_action.status != "QUEUED"
                    ):
                        raise RunConflict("action idempotency collision does not match existing outbox row")
                await self._append_event_locked(
                    session,
                    run,
                    event_type="ACTION_QUEUED" if action_created else "ACTION_DEDUPLICATED",
                    dedupe_key=f"run:{run_id}:action:{idem}",
                    payload={"action_kind": "CONTACT_JOB", "idempotency_key": idem},
                )

            result = {
                "outcome": "APPROVED" if decision == "APPROVE" else "REJECTED",
                "action_kind": "CONTACT_JOB" if action_created else None,
                "action_status": "QUEUED" if action_created else None,
                "action_deduplicated": decision == "APPROVE" and not action_created,
            }
            run.status = "COMPLETED"
            run.result_json = result
            run.resume_token = None
            run.resume_lease_until = None
            run.updated_at = now
            run.completed_at = now
            run.row_version += 1
            await self._append_event_locked(
                session,
                run,
                event_type="RUN_COMPLETED",
                dedupe_key=f"run:{run_id}:completed",
                payload=result,
            )
            return run

    async def list_events(self, run_id: str, subject_ref: str) -> list[AgentEvent]:
        await self.get_run(run_id, subject_ref)
        async with self._sessions() as session:
            return list(
                (
                    await session.scalars(
                        select(AgentEvent)
                        .where(AgentEvent.run_id == run_id)
                        .order_by(AgentEvent.seq)
                    )
                ).all()
            )

    async def _lock_run(
        self, session: AsyncSession, run_id: str, subject_ref: str
    ) -> AgentRun:
        run = await session.scalar(
            select(AgentRun)
            .where(AgentRun.run_id == run_id, AgentRun.subject_ref == subject_ref)
            .with_for_update()
        )
        if run is None:
            raise RunNotFound("run does not exist")
        return run

    async def _append_event_locked(
        self,
        session: AsyncSession,
        run: AgentRun,
        *,
        event_type: str,
        dedupe_key: str,
        payload: dict[str, Any],
    ) -> None:
        exists = await session.scalar(
            select(AgentEvent.event_id).where(AgentEvent.dedupe_key == dedupe_key)
        )
        if exists is not None:
            return
        run.last_event_seq += 1
        session.add(
            AgentEvent(
                event_id=str(uuid4()),
                run_id=run.run_id,
                seq=run.last_event_seq,
                event_type=event_type,
                dedupe_key=dedupe_key,
                payload_json=payload,
                correlation_id=None,
                causation_id=None,
                occurred_at=_utcnow(),
            )
        )

    @staticmethod
    def _validate_proposal(
        run: AgentRun, proposal_id: str, interrupt_id: str, preview_hash: str
    ) -> None:
        if (
            run.proposal_id != proposal_id
            or run.interrupt_id != interrupt_id
            or run.preview_hash != preview_hash
        ):
            raise RunConflict("approval does not match the server-side proposal")

    @staticmethod
    def _approval_matches(
        approval: AgentApproval,
        *,
        run_id: str,
        proposal_id: str,
        interrupt_id: str,
        preview_hash: str,
        decision: str,
        reason: str | None,
    ) -> bool:
        return (
            approval.run_id == run_id
            and approval.proposal_id == proposal_id
            and approval.interrupt_id == interrupt_id
            and approval.preview_hash == preview_hash
            and approval.decision == decision
            and approval.reason == reason
        )
