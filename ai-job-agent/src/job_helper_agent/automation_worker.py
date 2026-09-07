"""One leased scanner with independent heartbeat; only the API finalizes actions."""

import asyncio
import logging
import sqlite3
import time
from contextlib import suppress
from uuid import uuid4

from langgraph.types import Command

from job_helper_agent.automation_client import AutomationAPIError, AutomationClaim
from job_helper_agent.automation_graph import (
    GRAPH_VERSION,
    KINDS,
    AutomationRuntime,
    bounded_request,
    matches_claim,
    pause_value,
)

logger = logging.getLogger(__name__)


def api_error_code(code):
    if code is None:
        return None
    if code.startswith("CHECKPOINT"):
        return "CHECKPOINT_UNAVAILABLE"
    allowed = {
        "WORKER_UNAVAILABLE",
        "NETWORK_ERROR",
        "MODEL_UNAVAILABLE",
        "MODEL_TIMEOUT",
        "ANALYSIS_BUSY",
        "VALIDATION_FAILED",
        "WORKER_DEADLINE",
        "INTERNAL_ERROR",
    }
    return code if code in allowed else "INTERNAL_ERROR"


class AutomationWorker:
    def __init__(
        self,
        client,
        graphs,
        *,
        scan_seconds=5,
        job_timeout_seconds=300,
        renew_seconds=10,
        heartbeat_seconds=10,
    ):
        if set(graphs) != set(KINDS):
            raise ValueError("all unified graphs must be compiled")
        self.client, self.graphs = client, graphs
        self.scan_seconds, self.job_timeout_seconds = scan_seconds, job_timeout_seconds
        self.renew_seconds, self.heartbeat_seconds = renew_seconds, heartbeat_seconds
        self.worker_id = f"career-agent-{uuid4().hex}"
        self._task = None
        self._heartbeat_task = None
        self.last_error = None
        self.heartbeat_error = None
        self.last_successful_claim_at = None
        self.last_heartbeat_at = None
        self.last_completed_at = None

    @property
    def running(self):
        return all(
            task is not None and not task.done()
            for task in (self._task, self._heartbeat_task)
        )

    @property
    def ready(self):
        return (
            self.running
            and self.last_successful_claim_at is not None
            and self.last_heartbeat_at is not None
            and self.heartbeat_error is None
            and self.last_error is None
            and int(time.time() * 1000) - self.last_heartbeat_at
            <= max(30000, self.heartbeat_seconds * 3000)
        )

    def start(self):
        if self._task is not None or self._heartbeat_task is not None:
            raise RuntimeError("automation worker already started")
        self._heartbeat_task = asyncio.create_task(
            self._heartbeat(), name="career-heartbeat"
        )
        self._task = asyncio.create_task(self.run(), name="career-scanner")

    async def stop(self):
        tasks = [
            task for task in (self._task, self._heartbeat_task) if task is not None
        ]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._task = self._heartbeat_task = None

    async def _heartbeat(self):
        while True:
            try:
                await self.client.heartbeat(
                    self.worker_id, GRAPH_VERSION, api_error_code(self.last_error)
                )
                self.last_heartbeat_at = int(time.time() * 1000)
                self.heartbeat_error = None
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.heartbeat_error = (
                    error.code
                    if isinstance(error, AutomationAPIError)
                    else "INTERNAL_ERROR"
                )
            await asyncio.sleep(self.heartbeat_seconds)

    async def run(self):
        failures = 0
        while True:
            try:
                claim = await self.client.claim(self.worker_id)
                self.last_successful_claim_at = int(time.time() * 1000)
                self.last_error = None
                if claim is not None:
                    await self.process(claim)
                failures = 0
                await asyncio.sleep(self.scan_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.last_error = (
                    error.code
                    if isinstance(error, AutomationAPIError)
                    else "INTERNAL_ERROR"
                )
                logger.warning("Unified worker paused: %s", self.last_error)
                failures = min(failures + 1, 6)
                await asyncio.sleep(min(60, max(self.scan_seconds, 2**failures)))

    @staticmethod
    def graph_config(claim):
        return {"configurable": {"thread_id": f"automation:{claim.jobId}"}}

    async def _snapshot(self, graph, config):
        try:
            return await graph.aget_state(config)
        except Exception:
            raise AutomationAPIError("CHECKPOINT_UNAVAILABLE") from None

    async def _drive_graph(self, claim: AutomationClaim):
        graph, config = self.graphs[claim.kind], self.graph_config(claim)
        snapshot = await self._snapshot(graph, config)
        reconstructed = not snapshot.values
        reconcile = claim.executionMode == "RECONCILE_TERMINAL"
        initial = {
            "job_id": claim.jobId,
            "kind": claim.kind,
            "revision": claim.revision,
            "input_hash": claim.inputHash,
            "artifact_id": claim.artifactId,
            "result_id": claim.resultId,
            "wait_for": "NONE",
            "status": "PENDING",
            "terminal_reconcile": reconcile,
        }
        if snapshot.values:
            if not matches_claim(snapshot.values, claim):
                raise AutomationAPIError("CHECKPOINT_MISMATCH")
            for state_key, remote in (
                ("artifact_id", claim.artifactId),
                ("result_id", claim.resultId),
            ):
                local = snapshot.values.get(state_key)
                if local and remote and local != remote:
                    raise AutomationAPIError("CHECKPOINT_MISMATCH")
            if snapshot.next:
                if reconcile and (
                    snapshot.next != (f"{claim.kind.lower()}_finalize",)
                    or snapshot.interrupts
                ):
                    raise AutomationAPIError("CHECKPOINT_MISMATCH")
                initial = None
            elif snapshot.values.get("status") in {"COMPLETED", "FAILED"}:
                result = await bounded_request(
                    lambda: self.client.complete(claim, snapshot.values["artifact_id"])
                )
                if result.status != snapshot.values["status"]:
                    raise AutomationAPIError("INVALID_RESPONSE")
                return await self._finished(claim, snapshot)
            elif reconcile:
                raise AutomationAPIError("CHECKPOINT_MISMATCH")
        context = AutomationRuntime(self.client, claim)
        if not snapshot.interrupts:
            # A missing checkpoint is rebuilt only through idempotent API stages.
            # Durable API artifacts/actions/receipts remain authoritative, including
            # DISPATCHING/UNKNOWN; this graph has no action-dispatch operation.
            await graph.ainvoke(
                initial, config, context=context, durability="sync", version="v2"
            )
            snapshot = await self._snapshot(graph, config)
        if not snapshot.interrupts:
            return await self._finished(claim, snapshot)
        pause = self._pause(snapshot)
        if claim.executionMode == "START":
            await self._park(claim, snapshot, pause)
            return "PARKED"
        expected_wait = claim.executionMode.removeprefix("RESUME_")
        if expected_wait != snapshot.values["wait_for"]:
            if (
                reconstructed
                and expected_wait == "CONFIRMATION"
                and snapshot.values["wait_for"] == "EXECUTION"
            ):
                # The API already accepted approval while this checkpoint was
                # unavailable. Persist the newly reconstructed execution wait;
                # never pretend to resume a confirmation checkpoint we lack.
                await self._park(claim, snapshot, pause)
                return "PARKED"
            raise AutomationAPIError("CHECKPOINT_MISMATCH")
        await graph.ainvoke(
            Command(resume={pause.id: pause_value(snapshot.values)}),
            config,
            context=context,
            durability="sync",
            version="v2",
        )
        snapshot = await self._snapshot(graph, config)
        if snapshot.interrupts:
            # Approval can unlock execution, which needs a second durable wait.
            await self._park(claim, snapshot, self._pause(snapshot))
            return "PARKED"
        return await self._finished(claim, snapshot)

    async def _finished(self, claim, snapshot):
        status = self._terminal(snapshot)
        if status in {"COMPLETED", "FAILED"}:
            # The graph's synchronous checkpoint has reached END before the API
            # removes its terminal-reconciliation lease. Losing this ACK is safe.
            result = await bounded_request(
                lambda: self.client.graph_complete(
                    claim, snapshot.values["artifact_id"]
                )
            )
            if result.status != status:
                raise AutomationAPIError("INVALID_RESPONSE")
        return status

    @staticmethod
    def _terminal(snapshot):
        status = snapshot.values.get("status")
        if snapshot.next or status not in {
            "COMPLETED",
            "UNCERTAIN",
            "VALIDATION_FAILED",
            "FAILED",
        }:
            raise AutomationAPIError("CHECKPOINT_UNAVAILABLE")
        return status

    @staticmethod
    def _pause(snapshot):
        if len(snapshot.interrupts) != 1 or snapshot.values.get("wait_for") not in {
            "EXECUTION",
            "CONFIRMATION",
        }:
            raise AutomationAPIError("CHECKPOINT_MISMATCH")
        pause = snapshot.interrupts[0]
        if pause.value != pause_value(snapshot.values):
            raise AutomationAPIError("CHECKPOINT_MISMATCH")
        return pause

    async def _park(self, claim, snapshot, pause):
        await bounded_request(
            lambda: self.client.park(
                claim,
                snapshot.values["artifact_id"],
                pause.id,
                snapshot.values["wait_for"],
            )
        )

    async def _renew(self, claim):
        while True:
            await asyncio.sleep(self.renew_seconds)
            await self.client.renew(claim)

    async def _run_with_lease(self, claim):
        operation = asyncio.create_task(self._drive_graph(claim), name="career-graph")
        renewal = asyncio.create_task(self._renew(claim), name="career-lease")
        try:
            async with asyncio.timeout(self.job_timeout_seconds):
                done, _ = await asyncio.wait(
                    {operation, renewal}, return_when=asyncio.FIRST_COMPLETED
                )
                if renewal in done and operation not in done:
                    await renewal
                    raise AutomationAPIError("LEASE_LOST", lease_lost=True)
                return await operation
        finally:
            for task in (operation, renewal):
                task.cancel()
            await asyncio.gather(operation, renewal, return_exceptions=True)

    async def process(self, claim):
        try:
            result = await self._run_with_lease(claim)
            if result == "COMPLETED":
                self.last_completed_at = int(time.time() * 1000)
            elif result == "VALIDATION_FAILED":
                self.last_error = "VALIDATION_FAILED"
                await self._release(claim, "VALIDATION_FAILED")
        except asyncio.CancelledError:
            raise
        except AutomationAPIError as error:
            if error.lease_lost:
                return  # Failed node remains resumable with a newly claimed lease.
            code = api_error_code(error.code)
            await self._release(claim, code)
            raise
        except TimeoutError:
            await self._release(claim, "WORKER_DEADLINE")
            raise AutomationAPIError("WORKER_DEADLINE") from None
        except (sqlite3.Error, OSError):
            await self._release(claim, "CHECKPOINT_UNAVAILABLE")
            raise AutomationAPIError("CHECKPOINT_UNAVAILABLE") from None
        except Exception:
            await self._release(claim, "INTERNAL_ERROR")
            raise AutomationAPIError("INTERNAL_ERROR") from None

    async def _release(self, claim, code):
        try:
            await self.client.retry(claim, code)
        except AutomationAPIError:
            pass  # API expiry/reconciliation owns recovery after a lost lease.
