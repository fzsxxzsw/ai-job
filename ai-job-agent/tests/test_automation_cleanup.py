import asyncio
import json
import sqlite3
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite
import httpx
import job_helper_agent.main as agent_main
import pytest
from fastapi.testclient import TestClient
from job_helper_agent.automation_checkpoint import (
    DELETED_MARKER,
    AutomationCheckpointer,
)
from job_helper_agent.automation_cleanup import AutomationCleanupWorker
from job_helper_agent.automation_client import (
    AutomationAPIClient,
    AutomationAPIError,
    CleanupClaim,
)
from job_helper_agent.config import AgentConfig
from job_helper_agent.main import STRICT_CHECKPOINT_SERIALIZER
from langgraph.checkpoint.base import empty_checkpoint
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import SecretStr, ValidationError
from test_automation_worker import LEASE, TOKEN, FakeAutomationAPI, components, envelope


def config(thread="automation:job-1"):
    return {"configurable": {"thread_id": thread, "checkpoint_ns": ""}}


@asynccontextmanager
async def saver_at(path, saver_type=AutomationCheckpointer):
    async with aiosqlite.connect(path) as connection:
        saver = saver_type(connection, serde=STRICT_CHECKPOINT_SERIALIZER)
        await saver.setup()
        yield saver


async def seed(saver, thread="automation:job-1"):
    checkpoint = empty_checkpoint()
    checkpoint["channel_values"] = {"artifact_id": "synthetic-artifact-reference"}
    saved = await saver.aput(config(thread), checkpoint, {}, {})
    await saver.aput_writes(
        saved, [("artifact_id", "synthetic-artifact-reference")], "task-1"
    )
    return saved, checkpoint


async def counts(saver, thread="automation:job-1"):
    result = []
    for table in ("checkpoints", "writes", "automation_checkpoint_tombstone"):
        async with saver.conn.execute(
            f"SELECT count(*) FROM {table} WHERE thread_id = ?", (thread,)
        ) as cursor:
            result.append((await cursor.fetchone())[0])
    return tuple(result)


class FakeCleanupAPI(FakeAutomationAPI):
    def __init__(self):
        super().__init__(kind="CAREER_REVIEW", execution=False)
        self.status = "COMPLETED"
        self.cleanup_status, self.cleanup_lease = "PENDING", None
        self.cleanup_generation, self.cleanup_until = 0, 0
        self.deleted = True
        self.drop_cleanup_ack = False
        self.cleanup_fail = {}

    async def handle(self, request):
        path = request.url.path
        if not path.startswith("/internal/automation/cleanup/"):
            if self.deleted and path.endswith("/claim"):
                return httpx.Response(200, json=envelope(None))
            if self.deleted and not path.endswith("/heartbeat"):
                self.calls[path.rsplit("/", 1)[-1]] += 1
                return httpx.Response(409, json=envelope(None, 409, "JOB_DELETED"))
            return await super().handle(request)
        assert request.headers["X-Internal-Token"] == TOKEN
        body = json.loads(request.content)
        op = path.rsplit("/", 1)[-1]
        self.calls[f"cleanup-{op}"] += 1
        if op in self.cleanup_fail:
            code, message = self.cleanup_fail[op]
            return httpx.Response(code, json=envelope(None, code, message))
        if op == "claim":
            assert set(body) == {"workerId"}
            if self.cleanup_status == "DELETED" or (
                self.cleanup_status == "LEASED" and self.cleanup_until >= self.now
            ):
                return httpx.Response(200, json=envelope(None))
            self.cleanup_status = "LEASED"
            self.cleanup_generation += 1
            self.cleanup_lease = f"{LEASE}-cleanup-{self.cleanup_generation}"
            self.cleanup_until = self.now + 180_000
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "jobId": "job-1",
                        "kind": "CAREER_REVIEW",
                        "cleanupId": "cleanup-1",
                        "leaseToken": self.cleanup_lease,
                        "leaseUntil": self.cleanup_until,
                    }
                ),
            )
        assert body["jobId"] == "job-1" and path.split("/")[-2] == "cleanup-1"
        replay = op == "complete" and self.cleanup_status == "DELETED"
        if not replay and (
            body["leaseToken"] != self.cleanup_lease or self.cleanup_until < self.now
        ):
            return httpx.Response(409, json=envelope(None, 409, "LEASE_LOST"))
        if op == "renew":
            self.cleanup_until = self.now + 180_000
            data = {"cleanupId": "cleanup-1", "leaseUntil": self.cleanup_until}
        elif op == "complete":
            assert body["checkpointDeleted"] is True
            self.cleanup_status = "DELETED"
            data = {"jobId": "job-1", "cleanupId": "cleanup-1", "status": "DELETED"}
            if self.drop_cleanup_ack:
                self.drop_cleanup_ack = False
                raise httpx.ReadError("synthetic cleanup ACK loss", request=request)
        else:
            raise AssertionError(op)
        return httpx.Response(200, json=envelope(data))


def test_cross_connection_trigger_fences_base_saver_and_survives_restart(tmp_path):
    async def scenario():
        path = tmp_path / "shared.sqlite3"
        async with saver_at(path) as guarded, saver_at(path, AsyncSqliteSaver) as plain:
            saved, checkpoint = await seed(plain)
            await seed(guarded, "outcome:other-job")
            await guarded.permanently_delete("automation:job-1")
            assert await counts(guarded) == (0, 0, 1)
            for operation in (
                lambda: plain.aput(config(), checkpoint, {}, {}),
                lambda: plain.aput_writes(
                    saved, [("artifact_id", "late-write")], "late-task"
                ),
            ):
                with pytest.raises(sqlite3.IntegrityError, match=DELETED_MARKER):
                    await operation()
                await plain.conn.rollback()
            assert (await counts(guarded, "outcome:other-job"))[:2] == (1, 1)
        async with saver_at(path) as restarted:
            with pytest.raises(AutomationAPIError, match="JOB_DELETED") as raised:
                await restarted.aput(config(), checkpoint, {}, {})
            assert raised.value.lease_lost
            with pytest.raises(AutomationAPIError, match="JOB_DELETED"):
                await restarted.aput_writes(
                    saved, [("artifact_id", "late-write")], "late-task"
                )
            # Rejected writes roll back under the same lock: other threads work.
            await seed(restarted, "automation:unrelated")
            assert await counts(restarted) == (0, 0, 1)
            assert await counts(restarted, "automation:unrelated") == (1, 1, 0)
            columns = await (
                await restarted.conn.execute(
                    "PRAGMA table_info(automation_checkpoint_tombstone)"
                )
            ).fetchall()
            assert [column[1] for column in columns] == ["thread_id"]

    asyncio.run(scenario())


def test_sqlite_writer_lock_orders_preexisting_write_before_tombstone_delete(tmp_path):
    async def scenario():
        path = tmp_path / "race.sqlite3"
        async with saver_at(path) as guarded, aiosqlite.connect(path) as late:
            await seed(guarded)
            await late.execute("BEGIN IMMEDIATE")
            await late.execute(
                "UPDATE checkpoints SET metadata = ? WHERE thread_id = ?",
                (b'{"old":"writer"}', "automation:job-1"),
            )
            deleting = asyncio.create_task(
                guarded.permanently_delete("automation:job-1")
            )
            await asyncio.sleep(0.05)
            assert (
                not deleting.done()
            )  # A real SQLite writer lock, not a shared Python lock.
            await late.commit()
            await asyncio.wait_for(deleting, 5)
            assert await counts(guarded) == (0, 0, 1)
            with pytest.raises(sqlite3.IntegrityError, match=DELETED_MARKER):
                await late.execute(
                    "INSERT INTO writes (thread_id, checkpoint_id, task_id, idx) VALUES (?, ?, ?, ?)",
                    ("automation:job-1", "cp", "task", 0),
                )
            await late.rollback()
            assert await counts(guarded) == (0, 0, 1)

    asyncio.run(scenario())


def test_independent_process_cannot_resurrect_a_deleted_thread(tmp_path):
    async def prepare():
        async with saver_at(tmp_path / "process.sqlite3") as saver:
            await seed(saver)
            await saver.permanently_delete("automation:job-1")

    asyncio.run(prepare())
    script = Path(__file__).with_name("_automation_late_writer.py")
    result = subprocess.run(
        [sys.executable, str(script), str(tmp_path / "process.sqlite3")],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "BOTH_WRITES_BLOCKED"


def test_delete_failure_remains_fenced_and_new_cleanup_lease_finishes(
    tmp_path, monkeypatch
):
    async def scenario():
        peer = FakeCleanupAPI()
        path = tmp_path / "retry.sqlite3"
        original = AsyncSqliteSaver.adelete_thread

        async def fail_delete(self, thread_id):
            raise sqlite3.OperationalError("synthetic deletion failure")

        async with components(path, peer) as (client, _, _, saver):
            await seed(saver)
            claim = await client.cleanup_claim("first")
            cleaner = AutomationCleanupWorker(client, saver)
            monkeypatch.setattr(AsyncSqliteSaver, "adelete_thread", fail_delete)
            with pytest.raises(sqlite3.OperationalError):
                await cleaner.process(claim)
            assert await counts(saver) == (1, 1, 1)
            assert (
                peer.calls["cleanup-complete"] == 0 and cleaner.last_deleted_at is None
            )
        monkeypatch.setattr(AsyncSqliteSaver, "adelete_thread", original)
        peer.now += 200_000
        async with components(path, peer) as (client, _, _, saver):
            renewed = await client.cleanup_claim("second-process")
            assert renewed.leaseToken != claim.leaseToken
            cleaner = AutomationCleanupWorker(client, saver)
            await cleaner.process(renewed)
            assert peer.cleanup_status == "DELETED" and cleaner.last_deleted_at
            assert await counts(saver) == (0, 0, 1)

    asyncio.run(scenario())


def test_cleanup_ack_loss_is_idempotent_and_keeps_tombstone(tmp_path):
    async def scenario():
        peer = FakeCleanupAPI()
        peer.drop_cleanup_ack = True
        async with components(tmp_path / "ack.sqlite3", peer) as (client, _, _, saver):
            await seed(saver)
            cleaner = AutomationCleanupWorker(client, saver)
            await cleaner.process(await client.cleanup_claim("worker"))
            assert peer.calls["cleanup-complete"] == 2 and cleaner.last_deleted_at
            assert await counts(saver) == (0, 0, 1)

    asyncio.run(scenario())


@pytest.mark.parametrize("failure", ["lease_lost", "deadline"])
def test_cleanup_interruption_after_physical_delete_reclaims_without_false_ack(
    tmp_path, monkeypatch, failure
):
    async def scenario():
        peer = FakeCleanupAPI()
        path = tmp_path / "interrupted.sqlite3"
        original = AutomationCheckpointer.permanently_delete
        entered = asyncio.Event()

        async def hold_after_delete(self, thread_id):
            await original(self, thread_id)
            entered.set()
            if failure == "lease_lost":
                peer.cleanup_fail["renew"] = (409, "LEASE_LOST")
            await asyncio.Event().wait()

        async with components(path, peer) as (client, _, _, saver):
            await seed(saver)
            monkeypatch.setattr(
                AutomationCheckpointer, "permanently_delete", hold_after_delete
            )
            cleaner = AutomationCleanupWorker(
                client, saver, renew_seconds=0.01, timeout_seconds=0.2
            )
            if failure == "deadline":
                with pytest.raises(TimeoutError):
                    await cleaner.process(await client.cleanup_claim("first"))
            else:
                await cleaner.process(await client.cleanup_claim("first"))
            assert entered.is_set() and await counts(saver) == (0, 0, 1)
            assert (
                peer.calls["cleanup-complete"] == 0 and cleaner.last_deleted_at is None
            )
        monkeypatch.setattr(AutomationCheckpointer, "permanently_delete", original)
        peer.cleanup_fail.clear()
        peer.now += 200_000
        async with components(path, peer) as (client, _, _, saver):
            cleaner = AutomationCleanupWorker(client, saver)
            await cleaner.process(await client.cleanup_claim("restarted"))
            assert peer.cleanup_status == "DELETED" and cleaner.last_deleted_at
            assert await counts(saver) == (0, 0, 1)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "operation, data",
    [
        ("renew", {"cleanupId": "other-cleanup", "leaseUntil": 2_000_000_000_000}),
        (
            "complete",
            {"jobId": "other-job", "cleanupId": "cleanup-1", "status": "DELETED"},
        ),
        (
            "complete",
            {"jobId": "job-1", "cleanupId": "other-cleanup", "status": "DELETED"},
        ),
        (
            "complete",
            {"jobId": "job-1", "cleanupId": "cleanup-1", "status": "DELETING"},
        ),
    ],
)
def test_cleanup_responses_are_bound_to_the_exact_cleanup_and_job(operation, data):
    async def scenario():
        peer = FakeCleanupAPI()
        client = AutomationAPIClient(
            "http://api:9100",
            SecretStr(TOKEN),
            transport=httpx.MockTransport(peer.handle),
        )
        claim = await client.cleanup_claim("first")
        await client.close()

        def handle(request):
            body = json.loads(request.content)
            assert (
                body["jobId"] == claim.jobId
                and body["leaseToken"] == claim.leaseToken.get_secret_value()
            )
            if operation == "complete":
                assert body["checkpointDeleted"] is True
            return httpx.Response(200, json=envelope(data))

        client = AutomationAPIClient(
            "http://api:9100", SecretStr(TOKEN), transport=httpx.MockTransport(handle)
        )
        try:
            with pytest.raises(AutomationAPIError, match="INVALID_RESPONSE"):
                await getattr(client, f"cleanup_{operation}")(claim)
        finally:
            await client.close()

    asyncio.run(scenario())


def test_inflight_graph_is_fenced_after_cleanup_without_retry_or_action(tmp_path):
    async def scenario():
        peer = FakeCleanupAPI()
        peer.status, peer.deleted = "READY", False
        entered, resume = asyncio.Event(), asyncio.Event()

        async def compute_inflight():
            entered.set()
            await resume.wait()

        peer.compute_hook = compute_inflight
        async with components(tmp_path / "inflight.sqlite3", peer) as (
            client,
            _,
            worker,
            saver,
        ):
            running = asyncio.create_task(
                worker.process(await client.claim("business"))
            )
            await asyncio.wait_for(entered.wait(), 2)
            peer.deleted = True
            cleaner = AutomationCleanupWorker(client, saver)
            await cleaner.process(await client.cleanup_claim("cleanup"))
            resume.set()
            await asyncio.wait_for(running, 2)
            assert await counts(saver) == (0, 0, 1)
            assert peer.calls["retry"] == peer.calls["commit"] == 0
            assert peer.action_count == 0 and worker.last_completed_at is None

    asyncio.run(scenario())


def test_cleanup_lifecycle_runs_without_business_claim_and_reports_progress(
    tmp_path, monkeypatch
):
    peer = FakeCleanupAPI()
    monkeypatch.setattr(
        agent_main,
        "AutomationAPIClient",
        lambda url, token: AutomationAPIClient(
            url, token, transport=httpx.MockTransport(peer.handle)
        ),
    )
    app = agent_main.create_app(
        AgentConfig(
            automation_enabled=True,
            outcome_internal_token=TOKEN,
            checkpoint_path=tmp_path / "lifecycle.sqlite3",
        )
    )
    with TestClient(app) as client:
        deadline = time.monotonic() + 3
        while (
            app.state.automation_cleanup_worker.last_deleted_at is None
            and time.monotonic() < deadline
        ):
            time.sleep(0.01)
        response = client.get("/health/ready")
        assert response.status_code == 200
        assert response.json()["checks"]["automationCleanup"] == "running"
        info = response.json()["automation"]
        assert info["cleanupWorkerRunning"] and info["lastCheckpointDeletedAt"]
        assert info["lastCompletedAt"] is None and info["cleanupLastErrorCode"] is None
        assert TOKEN not in response.text and LEASE not in response.text
        cleaner = app.state.automation_cleanup_worker
    assert not cleaner.running


@pytest.mark.parametrize(
    "mutation",
    [
        {"kind": "REPLY"},
        {"jobId": "../private"},
        {"cleanupId": "../../private"},
        {"leaseToken": "short"},
        {"body": "private"},
    ],
)
def test_cleanup_claim_allows_only_bounded_career_references(mutation):
    data = {
        "jobId": "job-1",
        "kind": "CAREER_REVIEW",
        "cleanupId": "cleanup-1",
        "leaseToken": LEASE,
        "leaseUntil": 2_000_000_000_000,
    }
    data.update(mutation)
    with pytest.raises(ValidationError):
        CleanupClaim.model_validate(data)


def test_job_deleted_api_error_normally_stops_business_attempt(tmp_path):
    async def scenario():
        peer = FakeCleanupAPI()
        peer.deleted, peer.status = False, "READY"
        async with components(tmp_path / "deleted.sqlite3", peer) as (
            client,
            _,
            worker,
            _,
        ):
            claim = await client.claim("first")
            peer.deleted = True
            await worker.process(claim)
            assert peer.calls["gather"] == 1 and peer.calls["retry"] == 0
            assert worker.last_completed_at is None

    asyncio.run(scenario())


def test_career_confirmation_resumes_without_fake_action_receipts(tmp_path):
    class ReviewAPI(FakeAutomationAPI):
        async def handle(self, request):
            response = await super().handle(request)
            if request.url.path == "/internal/automation/claim":
                data = response.json()["data"]
                if data:
                    data["context"]["requiresConfirmation"] = False
                    data["resumeData"] = {"receipts": [], "approvals": []}
                    return httpx.Response(200, json=envelope(data))
            return response

    async def scenario():
        peer = ReviewAPI("CAREER_REVIEW", execution=False, confirmation=True)
        async with components(tmp_path / "review.sqlite3", peer) as (
            client,
            _,
            worker,
            _,
        ):
            await worker.process(await client.claim("first"))
            assert peer.status == "WAITING_CONFIRMATION"
            peer.approve()
            claim = await client.claim("confirmed")
            assert claim.executionMode == "RESUME_CONFIRMATION"
            assert not claim.resumeData.approvals and not claim.resumeData.receipts
            await worker.process(claim)
            assert peer.status == "COMPLETED" and peer.action_count == 0

    asyncio.run(scenario())
