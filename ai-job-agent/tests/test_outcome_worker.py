import asyncio
import json
import sqlite3
from collections import Counter
from contextlib import asynccontextmanager

import aiosqlite
import httpx
import pytest
from job_helper_agent.main import STRICT_CHECKPOINT_SERIALIZER
from job_helper_agent.outcome_client import OutcomeAPIClient, OutcomeAPIError
from job_helper_agent.outcome_graph import build_outcome_graph
from job_helper_agent.outcome_worker import OutcomeWorker
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import SecretStr
from test_outcome_client import LEASE, TOKEN, claim_data, envelope


class FakeOutcomeAPI:
    """Stateful protocol peer, with real HTTP serialization and synthetic data only."""

    def __init__(self, *, kind="FACTS_ONLY"):
        self.now = 2_000_000_000_000
        self.status = "READY"
        self.lease = None
        self.until = 0
        self.generation = 0
        self.artifact = None
        self.report = None
        self.feedback = None
        self.valid = True
        self.kind = kind
        self.calls = Counter()
        self.report_count = 0
        self.analysis_count = 0
        self.phases = []
        self.tokens_seen = []
        self.fail_before = {}
        self.drop_after = set()
        self.analyze_hook = None
        self.park_hook = None
        self.after_save_hook = None

    def give_feedback(self, action="CONFIRM"):
        assert self.report
        self.feedback = {
            "feedbackId": "feedback-1",
            "reportId": self.report,
            "action": action,
        }
        if self.status == "WAITING_CONFIRMATION":
            self.status = "CONFIRMATION_READY"

    def data(self):
        data = claim_data(
            leaseToken=self.lease,
            leaseUntil=self.until,
            artifactId=self.artifact,
            reportId=self.report,
            executionMode="RESUME_CONFIRMATION" if self.feedback else "START",
            humanFeedback=self.feedback,
            phase="SAVED" if self.report else "COLLECTING",
        )
        data["context"]["analysisKind"] = self.kind
        if self.kind == "REJECTION_CAUSES":
            data["context"]["outcome"] = "REJECTED"
        return data

    async def handle(self, request):
        assert request.headers["X-Internal-Token"] == TOKEN
        operation = request.url.path.rsplit("/", 1)[-1]
        assert request.method == "POST"
        self.calls[operation] += 1
        body = json.loads(request.content)
        if operation in self.fail_before:
            code, message = self.fail_before[operation]
            return httpx.Response(code, json=envelope(None, code=code, message=message))
        if operation == "claim":
            assert set(body) == {"workerId"}
            available = self.status in {"READY", "RETRY", "CONFIRMATION_READY"} or (
                self.status == "RUNNING" and self.until < self.now
            )
            if not available:
                return httpx.Response(200, json=envelope(None))
            self.generation += 1
            self.lease = f"{LEASE}-{self.generation}"
            self.until = self.now + 180_000
            self.status = "RUNNING"
            self.phases.append("COLLECTING")
            return httpx.Response(200, json=envelope(self.data()))
        self.tokens_seen.append(body["leaseToken"])
        assert body["revision"] == 1 and body["inputHash"] == "a" * 64
        # Publication/completion replay is read-only and idempotent.
        replay = (operation == "commit" and self.report) or (
            operation == "complete" and self.status == "COMPLETED"
        )
        if not replay and (
            body["leaseToken"] != self.lease
            or self.until < self.now
            or self.status != "RUNNING"
        ):
            return httpx.Response(
                409, json=envelope(None, code=409, message="LEASE_LOST")
            )
        if operation == "renew":
            self.until = self.now + 180_000
            data = {"jobId": "job-1", "revision": 1, "leaseUntil": self.until}
        elif operation == "analyze":
            assert body["analysisKind"] == self.kind
            if self.analyze_hook:
                await self.analyze_hook()
            reused = self.artifact is not None
            if not reused:
                self.analysis_count += 1
                self.artifact = "artifact-1"
            self.phases.append("ANALYZING")
            data = {
                "jobId": "job-1",
                "revision": 1,
                "inputHash": "a" * 64,
                "artifactId": self.artifact,
                "reused": reused,
            }
        elif operation == "validate":
            assert body["artifactId"] == self.artifact
            self.phases.append("VALIDATING")
            data = {"jobId": "job-1", "artifactId": self.artifact, "valid": self.valid}
            if self.valid:
                data["validationVersion"] = "outcome-validation-v1"
            else:
                self.status = "FAILED"
                data.update(status="FAILED", errorCode="INVALID_ARTIFACT")
        elif operation == "commit":
            assert self.valid and body["artifactId"] == self.artifact
            if not self.report:
                self.report = "report-1"
                self.report_count += 1
                self.phases.extend(["SAVING", "SAVED"])
            if self.after_save_hook:
                self.after_save_hook()
            data = {
                "jobId": "job-1",
                "caseId": "case-1",
                "caseRevision": 1,
                "reportId": self.report,
                "status": "RUNNING",
                "phase": "SAVED",
                "isCurrent": True,
            }
        elif operation == "park":
            assert body["artifactId"] == self.artifact and body["interruptId"]
            if self.park_hook:
                await self.park_hook(body["interruptId"])
            self.status = (
                "CONFIRMATION_READY" if self.feedback else "WAITING_CONFIRMATION"
            )
            self.phases.append("WAITING_CONFIRMATION")
            self.lease = None
            data = {
                "jobId": "job-1",
                "reportId": self.report,
                "status": self.status,
                "phase": "WAITING_CONFIRMATION",
            }
        elif operation == "complete":
            assert body["artifactId"] == self.artifact
            assert self.feedback and body["feedbackId"] == self.feedback["feedbackId"]
            self.status = "COMPLETED"
            self.phases.append("COMPLETED")
            data = {
                "jobId": "job-1",
                "caseId": "case-1",
                "caseRevision": 1,
                "reportId": self.report,
                "status": "COMPLETED",
                "isCurrent": True,
            }
        elif operation == "retry":
            assert body["errorCode"] in {
                "DEPENDENCY_UNAVAILABLE",
                "CHECKPOINT_UNAVAILABLE",
                "INTERNAL_FAILURE",
            }
            self.last_retry = body["errorCode"]
            self.status = "RETRY"
            self.lease = None
            data = {
                "jobId": "job-1",
                "status": "RETRY",
                "nextAttemptAt": self.now + 5_000,
            }
        else:
            raise AssertionError(f"unexpected API operation: {operation}")
        if operation in self.drop_after:
            self.drop_after.remove(operation)
            raise httpx.ReadError(
                "lost response with private values must not be logged", request=request
            )
        return httpx.Response(200, json=envelope(data))


@asynccontextmanager
async def components(path, peer, *, saver_type=AsyncSqliteSaver, **worker_options):
    connection = await aiosqlite.connect(path)
    saver = saver_type(connection, serde=STRICT_CHECKPOINT_SERIALIZER)
    await saver.setup()
    graph = build_outcome_graph(saver)
    client = OutcomeAPIClient(
        "http://api:9100", SecretStr(TOKEN), transport=httpx.MockTransport(peer.handle)
    )
    worker = OutcomeWorker(client, graph, **worker_options)
    try:
        yield client, graph, worker
    finally:
        await worker.stop()
        await client.close()
        await connection.close()


@pytest.mark.parametrize("kind", ["FACTS_ONLY", "REJECTION_CAUSES"])
@pytest.mark.parametrize("action", ["CONFIRM", "CORRECT", "IGNORE"])
def test_real_graph_runs_all_stages_then_restarts_at_human_interrupt(
    tmp_path, kind, action
):
    async def scenario():
        peer = FakeOutcomeAPI(kind=kind)
        checkpoint = tmp_path / "outcomes.sqlite3"
        async with components(checkpoint, peer) as (client, graph, worker):
            claim = await client.claim("first-process")

            async def check_durable_park(interrupt_id):
                snapshot = await graph.aget_state(
                    {"configurable": {"thread_id": "outcome:job-1"}}
                )
                assert snapshot.interrupts[0].id == interrupt_id
                assert snapshot.next == ("await_human",)

            peer.park_hook = check_durable_park
            await worker.process(claim)
            assert peer.status == "WAITING_CONFIRMATION"
            assert peer.calls["complete"] == 0
            assert await client.claim("idle-scanner") is None
            assert peer.phases == [
                "COLLECTING",
                "ANALYZING",
                "VALIDATING",
                "SAVING",
                "SAVED",
                "WAITING_CONFIRMATION",
            ]
        peer.park_hook = None
        peer.give_feedback(action)
        async with components(checkpoint, peer) as (client, graph, worker):
            resumed = await client.claim("second-process")
            assert resumed.leaseToken != claim.leaseToken
            await worker.process(resumed)
            snapshot = await graph.aget_state(
                {"configurable": {"thread_id": "outcome:job-1"}}
            )
            assert snapshot.values["status"] == "COMPLETED"
            assert not snapshot.next and not snapshot.interrupts
            assert peer.status == "COMPLETED"
            assert peer.report_count == peer.analysis_count == 1
            assert peer.calls["validate"] == peer.calls["commit"] == 1
            assert peer.calls["complete"] == 1
        contents = checkpoint.read_bytes()
        assert TOKEN.encode() not in contents
        assert LEASE.encode() not in contents
        assert b"X-Internal-Token" not in contents

    asyncio.run(scenario())


def test_failed_validation_is_a_visible_terminal_and_never_saves(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        peer.valid = False
        async with components(tmp_path / "invalid.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            await worker.process(await client.claim("worker"))
            snapshot = await graph.aget_state(
                {"configurable": {"thread_id": "outcome:job-1"}}
            )
            assert snapshot.values["status"] == "FAILED"
            assert peer.status == "FAILED"
            assert (
                peer.calls["commit"]
                == peer.calls["park"]
                == peer.calls["complete"]
                == 0
            )

    asyncio.run(scenario())


@pytest.mark.parametrize("operation", ["analyze", "commit", "complete"])
def test_lost_http_ack_retries_idempotently_without_recreating_report(
    tmp_path, operation
):
    async def scenario():
        peer = FakeOutcomeAPI()
        peer.drop_after.add(operation)
        async with components(tmp_path / "lost.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            await worker.process(await client.claim("worker"))
            peer.give_feedback()
            await worker.process(await client.claim("worker"))
            assert peer.status == "COMPLETED"
            assert peer.calls[operation] == 2
            assert peer.report_count == peer.analysis_count == 1

    asyncio.run(scenario())


class FailInterruptSaver(AsyncSqliteSaver):
    async def aput_writes(self, config, writes, task_id, task_path=""):
        if any(channel == "__interrupt__" for channel, _ in writes):
            raise sqlite3.OperationalError(
                "simulated disk failure before interrupt persistence"
            )
        return await super().aput_writes(config, writes, task_id, task_path)


@pytest.mark.parametrize(
    "lose_checkpoint,early_feedback", [(False, False), (True, False), (True, True)]
)
def test_save_before_interrupt_crash_reclaims_and_replays_cached_references(
    tmp_path, lose_checkpoint, early_feedback
):
    async def scenario():
        peer = FakeOutcomeAPI()
        original = tmp_path / "crashed.sqlite3"
        async with components(original, peer, saver_type=FailInterruptSaver) as (
            client,
            graph,
            worker,
        ):
            claim = await client.claim("crashing-process")
            with pytest.raises(sqlite3.OperationalError):
                await worker._drive_graph(claim)
            assert peer.report_count == 1 and peer.status == "RUNNING"
            assert peer.calls["park"] == 0
        if early_feedback:
            peer.give_feedback()
        peer.now = peer.until + 1
        recovered = tmp_path / "replacement.sqlite3" if lose_checkpoint else original
        async with components(recovered, peer) as (client, graph, worker):
            claim = await client.claim("replacement-process")
            await worker.process(claim)
            assert peer.status == (
                "COMPLETED" if early_feedback else "WAITING_CONFIRMATION"
            )
            assert peer.report_count == peer.analysis_count == 1

    asyncio.run(scenario())


def test_feedback_arriving_between_save_and_park_is_not_lost(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        peer.after_save_hook = peer.give_feedback
        async with components(tmp_path / "race.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            await worker.process(await client.claim("worker"))
            assert peer.status == "CONFIRMATION_READY"
            await worker.process(await client.claim("worker"))
            assert peer.status == "COMPLETED"
            assert peer.report_count == 1

    asyncio.run(scenario())


def test_expired_unexecuted_claim_is_recoverable_without_browser(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        async with components(tmp_path / "expiry.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            abandoned = await client.claim("dead-process")
            assert await client.claim("another-process") is None
            peer.now = peer.until + 1
            reclaimed = await client.claim("another-process")
            assert abandoned.jobId == reclaimed.jobId
            assert abandoned.leaseToken != reclaimed.leaseToken
            await worker.process(reclaimed)
            assert peer.status == "WAITING_CONFIRMATION"

    asyncio.run(scenario())


def test_lease_loss_cancels_analysis_and_never_publishes(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        cancelled = asyncio.Event()

        async def blocking_analysis():
            peer.fail_before["renew"] = (409, "LEASE_LOST")
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        peer.analyze_hook = blocking_analysis
        async with components(tmp_path / "lease.sqlite3", peer, renew_seconds=0.01) as (
            client,
            graph,
            worker,
        ):
            await asyncio.wait_for(
                worker.process(await client.claim("worker")), timeout=1
            )
            assert cancelled.is_set()
            assert peer.calls["commit"] == peer.calls["retry"] == 0

    asyncio.run(scenario())


def test_long_analysis_renews_and_deadline_releases_for_capped_server_retry(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        peer.analyze_hook = lambda: asyncio.sleep(10)
        async with components(
            tmp_path / "deadline.sqlite3",
            peer,
            renew_seconds=0.01,
            job_timeout_seconds=0.08,
        ) as (client, graph, worker):
            with pytest.raises(OutcomeAPIError, match="DEPENDENCY_UNAVAILABLE"):
                await worker.process(await client.claim("worker"))
            assert peer.calls["renew"] >= 2
            assert (
                peer.status == "RETRY" and peer.last_retry == "DEPENDENCY_UNAVAILABLE"
            )
            assert peer.calls["commit"] == 0

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "operation", ["analyze", "validate", "commit", "park", "complete"]
)
def test_new_revision_stale_response_never_retries_old_publication(tmp_path, operation):
    async def scenario():
        peer = FakeOutcomeAPI()
        async with components(tmp_path / "stale.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            if operation == "complete":
                await worker.process(await client.claim("worker"))
                peer.give_feedback()
            peer.fail_before[operation] = (409, "REVISION_SUPERSEDED")
            await worker.process(await client.claim("worker"))
            assert peer.calls["retry"] == 0
            assert peer.calls[operation] == 1
            assert peer.status != "COMPLETED"
            if operation in {"analyze", "validate", "commit"}:
                assert peer.report_count == 0

    asyncio.run(scenario())


def test_checkpoint_failure_is_explicit_and_never_auto_confirms(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        async with components(
            tmp_path / "disk.sqlite3", peer, saver_type=FailInterruptSaver
        ) as (client, graph, worker):
            with pytest.raises(OutcomeAPIError, match="CHECKPOINT_UNAVAILABLE"):
                await worker.process(await client.claim("worker"))
            assert peer.last_retry == "CHECKPOINT_UNAVAILABLE"
            assert peer.report_count == 1
            assert peer.calls["park"] == peer.calls["complete"] == 0

    asyncio.run(scenario())


def test_startup_scanner_claims_without_request_and_shutdown_stops_work(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        async with components(
            tmp_path / "scanner.sqlite3", peer, scan_seconds=0.01
        ) as (client, graph, worker):
            worker.start()
            async with asyncio.timeout(2):
                while peer.status != "WAITING_CONFIRMATION":
                    await asyncio.sleep(0.01)
            assert worker.running
            await worker.stop()
            count = sum(peer.calls.values())
            await asyncio.sleep(0.03)
            assert sum(peer.calls.values()) == count
            assert not worker.running

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "status,message", [(401, TOKEN), (503, "DEPENDENCY_UNAVAILABLE")]
)
def test_unavailable_api_pauses_scanner_without_busy_spin_or_secret_log(
    tmp_path, caplog, status, message
):
    async def scenario():
        peer = FakeOutcomeAPI()
        peer.fail_before["claim"] = (status, message)
        async with components(tmp_path / "paused.sqlite3", peer, scan_seconds=0.01) as (
            client,
            graph,
            worker,
        ):
            worker.start()
            await asyncio.sleep(0.05)
            assert worker.running and worker.last_error
            assert peer.calls["claim"] == 1
            assert TOKEN not in caplog.text

    asyncio.run(scenario())


def test_analysis_busy_retries_are_bounded_and_job_lease_is_renewed(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        peer.fail_before["analyze"] = (409, "ANALYSIS_BUSY")
        async with components(tmp_path / "busy.sqlite3", peer, renew_seconds=0.1) as (
            client,
            graph,
            worker,
        ):
            with pytest.raises(OutcomeAPIError, match="ANALYSIS_BUSY"):
                await worker.process(await client.claim("worker"))
            assert peer.calls["analyze"] == 3
            assert peer.calls["renew"] >= 2
            assert peer.status == "RETRY"
            assert peer.calls["commit"] == 0

    asyncio.run(scenario())


def test_park_ack_loss_leaves_durable_interrupt_without_duplicate_report(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        peer.drop_after.add("park")
        async with components(tmp_path / "park.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            await worker.process(await client.claim("worker"))
            assert peer.status == "WAITING_CONFIRMATION"
            peer.give_feedback()
            await worker.process(await client.claim("worker"))
            assert peer.status == "COMPLETED"
            assert peer.report_count == peer.analysis_count == 1

    asyncio.run(scenario())


def test_checkpoint_identity_cannot_be_rebound_to_new_input_hash(tmp_path):
    async def scenario():
        peer = FakeOutcomeAPI()
        async with components(tmp_path / "hash.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            await worker.process(await client.claim("worker"))
            peer.give_feedback()
            claim = await client.claim("worker")
            changed = claim.model_copy(
                update={
                    "inputHash": "b" * 64,
                    "context": claim.context.model_copy(update={"inputHash": "b" * 64}),
                }
            )
            with pytest.raises(OutcomeAPIError, match="CHECKPOINT_MISMATCH"):
                await worker._drive_graph(changed)
            assert peer.calls["complete"] == peer.calls["retry"] == 0
            assert peer.report_count == 1

    asyncio.run(scenario())


def test_unreadable_checkpoint_reports_error_instead_of_inventing_confirmation(
    tmp_path,
):
    async def scenario():
        peer = FakeOutcomeAPI()
        checkpoint = tmp_path / "corrupt.sqlite3"
        async with components(checkpoint, peer) as (client, graph, worker):
            await worker.process(await client.claim("worker"))
        peer.give_feedback()
        async with aiosqlite.connect(checkpoint) as connection:
            await connection.execute(
                "UPDATE checkpoints SET checkpoint = ?", (b"invalid checkpoint",)
            )
            await connection.commit()
        async with components(checkpoint, peer) as (client, graph, worker):
            with pytest.raises(OutcomeAPIError, match="CHECKPOINT_UNAVAILABLE"):
                await worker.process(await client.claim("worker"))
            assert peer.last_retry == "CHECKPOINT_UNAVAILABLE"
            assert peer.calls["complete"] == 0
            assert peer.report_count == 1

    asyncio.run(scenario())
