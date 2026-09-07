"""One bounded scanner per Agent process; API leases fence multiple processes."""

import asyncio
import logging
import sqlite3
import time
from contextlib import suppress
from uuid import uuid4

from langgraph.types import Command

from job_helper_agent.outcome_client import (
    OutcomeAPIClient,
    OutcomeAPIError,
    OutcomeClaim,
)
from job_helper_agent.outcome_graph import (
    OutcomeRuntime,
    OutcomeState,
    bounded_request,
    matches_claim,
)

logger = logging.getLogger(__name__)


class OutcomeWorker:
    def __init__(
        self,
        client: OutcomeAPIClient,
        graph,
        *,
        scan_seconds: float = 5,
        job_timeout_seconds: float = 300,
        renew_seconds: float = 10,
    ):
        self.client = client
        self.graph = graph
        self.scan_seconds = scan_seconds
        self.job_timeout_seconds = job_timeout_seconds
        self.renew_seconds = renew_seconds
        self.worker_id = f"outcome-agent-{uuid4().hex}"
        self._task: asyncio.Task | None = None
        self.last_error: str | None = None
        self.last_successful_claim_at: int | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        if self.running:
            raise RuntimeError("outcome worker already started")
        self._task = asyncio.create_task(self.run(), name="outcome-scanner")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def run(self) -> None:
        failures = 0
        while True:
            try:
                claim = await self.client.claim(self.worker_id)
                self.last_successful_claim_at = int(time.time() * 1000)
                self.last_error = None
                if claim is None:
                    failures = 0
                    await asyncio.sleep(self.scan_seconds)
                    continue
                await self.process(claim)
                failures = 0
                # Also bounds a faulty upstream repeatedly offering an obsolete job.
                await asyncio.sleep(self.scan_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # Do not log exceptions: HTTP or validation details can contain secrets.
                self.last_error = (
                    error.code
                    if isinstance(error, OutcomeAPIError)
                    else "INTERNAL_FAILURE"
                )
                logger.warning("Outcome worker paused: %s", self.last_error)
                failures = min(failures + 1, 6)
                await asyncio.sleep(min(60, max(self.scan_seconds, 2**failures)))

    async def _drive_graph(self, claim: OutcomeClaim) -> None:
        config = {"configurable": {"thread_id": f"outcome:{claim.jobId}"}}
        try:
            snapshot = await self.graph.aget_state(config)
        except Exception:
            raise OutcomeAPIError("CHECKPOINT_UNAVAILABLE", retryable=True) from None
        initial: OutcomeState | None = {
            "job_id": claim.jobId,
            "case_id": claim.caseId,
            "revision": claim.revision,
            "input_hash": claim.inputHash,
            "analysis_kind": claim.context.analysisKind,
            "artifact_id": claim.artifactId,
            "status": "PENDING",
        }
        if snapshot.values:
            if not matches_claim(snapshot.values, claim):
                raise OutcomeAPIError("CHECKPOINT_MISMATCH")
            if snapshot.next:
                initial = None
            elif snapshot.values.get("status") == "COMPLETED":
                artifact = snapshot.values.get("artifact_id")
                if not artifact:
                    raise OutcomeAPIError("INVALID_CHECKPOINT")
                await bounded_request(lambda: self.client.complete(claim, artifact))
                return
            elif snapshot.values.get("status") in {"SUPERSEDED", "FAILED"}:
                raise OutcomeAPIError("REVISION_SUPERSEDED", superseded=True)
        context = OutcomeRuntime(self.client, claim)
        if not snapshot.interrupts:
            await self.graph.ainvoke(
                initial,
                config,
                context=context,
                durability="sync",
                version="v2",
            )
            snapshot = await self.graph.aget_state(config)
        if snapshot.values.get("status") in {"SUPERSEDED", "FAILED", "COMPLETED"}:
            return
        if len(snapshot.interrupts) != 1:
            raise OutcomeAPIError("INVALID_CHECKPOINT")
        pause = snapshot.interrupts[0]
        if pause.value != {
            "jobId": claim.jobId,
            "reportId": snapshot.values.get("report_id"),
            "revision": claim.revision,
        }:
            raise OutcomeAPIError("INVALID_CHECKPOINT")
        if claim.executionMode == "START":
            await bounded_request(
                lambda: self.client.park(
                    claim,
                    snapshot.values["artifact_id"],
                    snapshot.values["report_id"],
                    pause.id,
                )
            )
            return
        if (
            claim.humanFeedback is None
            or claim.humanFeedback.reportId != snapshot.values["report_id"]
        ):
            raise OutcomeAPIError("INVALID_HUMAN_FEEDBACK")
        await self.graph.ainvoke(
            Command(resume={pause.id: claim.humanFeedback.model_dump()}),
            config,
            context=context,
            durability="sync",
            version="v2",
        )

    async def _renew(self, claim: OutcomeClaim) -> None:
        while True:
            await asyncio.sleep(self.renew_seconds)
            await self.client.renew(claim)

    async def _run_with_lease(self, claim: OutcomeClaim) -> None:
        operation = asyncio.create_task(self._drive_graph(claim), name="outcome-graph")
        renewal = asyncio.create_task(self._renew(claim), name="outcome-lease")
        try:
            async with asyncio.timeout(self.job_timeout_seconds):
                done, _ = await asyncio.wait(
                    {operation, renewal}, return_when=asyncio.FIRST_COMPLETED
                )
                if renewal in done and operation not in done:
                    # Any failed renewal stops in-flight work promptly. Commit still
                    # has server-side fencing in case cancellation races publication.
                    await renewal
                    raise OutcomeAPIError("LEASE_LOST", lease_lost=True)
                await operation
        finally:
            for task in (operation, renewal):
                task.cancel()
            await asyncio.gather(operation, renewal, return_exceptions=True)

    async def process(self, claim: OutcomeClaim) -> None:
        try:
            await self._run_with_lease(claim)
        except asyncio.CancelledError:
            # Shutdown leaves the job leased; the API makes it reclaimable on expiry.
            raise
        except OutcomeAPIError as error:
            if error.superseded or error.lease_lost:
                # Lease loss must not rewrite the graph to a business terminal or
                # retry an expired token. Its failed node stays resumable in SQLite.
                return
            if error.code in {
                "CHECKPOINT_UNAVAILABLE",
                "INVALID_CHECKPOINT",
                "CHECKPOINT_MISMATCH",
            }:
                code = "CHECKPOINT_UNAVAILABLE"
            elif error.code in {
                "DEPENDENCY_UNAVAILABLE",
                "ANALYSIS_BUSY",
                "AUTH_UNAVAILABLE",
            }:
                code = "DEPENDENCY_UNAVAILABLE"
            else:
                # Unknown responses and integrity conflicts are visible safe
                # failures with the API's capped retry budget, never supersession.
                code = "INTERNAL_FAILURE"
            await self._release(claim, code)
            raise
        except TimeoutError:
            await self._release(claim, "DEPENDENCY_UNAVAILABLE")
            raise OutcomeAPIError("DEPENDENCY_UNAVAILABLE", retryable=True) from None
        except (sqlite3.Error, OSError):
            await self._release(claim, "CHECKPOINT_UNAVAILABLE")
            raise OutcomeAPIError("CHECKPOINT_UNAVAILABLE", retryable=True) from None
        except Exception:
            await self._release(claim, "INTERNAL_FAILURE")
            raise OutcomeAPIError("INTERNAL_FAILURE") from None

    async def _release(self, claim: OutcomeClaim, code) -> None:
        try:
            await self.client.retry(claim, code)
        except OutcomeAPIError:
            # Lost/expired/committed leases and API downtime are recovered by claim.
            pass
