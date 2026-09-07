import asyncio
import json
import sqlite3
from collections import Counter
from contextlib import asynccontextmanager

import aiosqlite
import httpx
import pytest
from job_helper_agent.automation_checkpoint import AutomationCheckpointer
from job_helper_agent.automation_client import AutomationAPIClient, AutomationAPIError
from job_helper_agent.automation_graph import KINDS, build_automation_graphs
from job_helper_agent.automation_worker import AutomationWorker, api_error_code
from job_helper_agent.main import STRICT_CHECKPOINT_SERIALIZER
from pydantic import SecretStr

TOKEN = "automation-test-internal-secret-never-checkpoint-0000"
LEASE = "automation-test-lease-secret-never-checkpoint-1111"


def envelope(data, code=200, message="success"):
    return {"code": code, "message": message, "data": data}


def claim_data(**overrides):
    data = {
        "jobId": "job-1",
        "kind": "REPLY",
        "revision": 1,
        "inputHash": "a" * 64,
        "leaseToken": LEASE,
        "leaseUntil": 2_000_000_180_000,
        "executionMode": "START",
        "phase": "COLLECTING",
        "artifactId": None,
        "resultId": None,
        "resumeData": {"receipts": [], "approvals": []},
        "context": {
            "schemaVersion": 1,
            "jobKind": "REPLY",
            "requiresExecution": True,
            "requiresConfirmation": False,
        },
    }
    data.update(overrides)
    return data


class FakeAutomationAPI:
    """Synthetic durable API peer; HTTP serialization and graph saver are real."""

    def __init__(self, kind="REPLY", *, execution=True, confirmation=False, ready=True):
        self.kind, self.execution, self.confirmation = kind, execution, confirmation
        self.ready, self.valid = ready, True
        self.status, self.lease, self.generation = "READY", None, 0
        self.artifact, self.result = None, None
        self.receipt, self.approval = None, None
        self.now, self.until = 2_000_000_000_000, 0
        self.calls, self.tokens_seen, self.phases = Counter(), [], []
        self.compute_count, self.action_count = 0, 0
        self.fail_before, self.drop_after = {}, set()
        self.compute_hook = self.park_hook = self.commit_hook = None
        self.renew_hook = None
        self.last_retry = None
        self.heartbeat_errors = []
        self.graph_finalized = True

    def wait_for(self):
        if self.confirmation and self.approval is None:
            return "CONFIRMATION"
        if self.execution and self.receipt is None and self.approval != "DECLINE":
            return "EXECUTION"
        return "NONE"

    def approve(self, decision="APPROVE"):
        self.approval = decision
        if self.status == "WAITING_CONFIRMATION":
            self.status = "CONFIRMATION_READY"

    def acknowledge(self, status="ACKNOWLEDGED"):
        self.receipt = status
        if self.status in {"WAITING_EXECUTION", "UNCERTAIN"}:
            self.status = "EXECUTION_READY"

    async def handle(self, request):
        assert request.headers["X-Internal-Token"] == TOKEN
        assert request.method == "POST"
        if request.url.path == "/internal/automation/cleanup/claim":
            return httpx.Response(200, json=envelope(None))
        op = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content)
        self.calls[op] += 1
        if op == "renew" and self.renew_hook:
            await self.renew_hook()
        if op in self.fail_before:
            status, code = self.fail_before[op]
            return httpx.Response(status, json=envelope(None, status, code))
        if op == "heartbeat":
            assert set(body) == {"workerId", "graphVersion", "lastErrorCode"}
            assert body["lastErrorCode"] == api_error_code(body["lastErrorCode"])
            self.heartbeat_errors.append(body["lastErrorCode"])
            return httpx.Response(
                200,
                json=envelope(
                    {
                        "workerId": body["workerId"],
                        "graphVersion": body["graphVersion"],
                        "lastSeenAt": self.now,
                    }
                ),
            )
        if op == "claim":
            assert set(body) == {"workerId"}
            available = self.status in {
                "READY",
                "RETRY",
                "EXECUTION_READY",
                "CONFIRMATION_READY",
            }
            if self.status == "RUNNING" and self.until < self.now:
                available = True
            terminal_pending = (
                self.status in {"COMPLETED", "FAILED"} and not self.graph_finalized
            )
            if terminal_pending and self.until < self.now:
                available = True
            if not available:
                return httpx.Response(200, json=envelope(None))
            prior = self.status
            mode = (
                "RESUME_CONFIRMATION"
                if prior == "CONFIRMATION_READY"
                else ("RESUME_EXECUTION" if prior == "EXECUTION_READY" else "START")
            )
            if terminal_pending:
                mode = "RECONCILE_TERMINAL"
            self.generation += 1
            self.lease, self.until = f"{LEASE}-{self.generation}", self.now + 180_000
            if not terminal_pending:
                self.status = "RUNNING"
            data = claim_data(
                kind=self.kind,
                leaseToken=self.lease,
                leaseUntil=self.until,
                artifactId=self.artifact,
                resultId=self.result,
                executionMode=mode,
                phase="FINALIZING" if mode != "START" else "COLLECTING",
                context={
                    "schemaVersion": 1,
                    "jobKind": self.kind,
                    "requiresExecution": self.execution,
                    "requiresConfirmation": self.confirmation,
                },
                resumeData={
                    "receipts": [{"actionId": "action-1", "status": self.receipt}]
                    if self.receipt
                    else [],
                    "approvals": [
                        {
                            "actionId": "action-1",
                            "approvalId": "approval-1",
                            "decision": self.approval,
                        }
                    ]
                    if self.approval
                    else [],
                },
            )
            return httpx.Response(200, json=envelope(data))
        assert body["revision"] == 1 and body["inputHash"] == "a" * 64
        self.tokens_seen.append(body["leaseToken"])
        replay = op == "complete" and self.status in {
            "COMPLETED",
            "FAILED",
            "UNCERTAIN",
        }
        if (
            op == "graph-complete"
            and self.graph_finalized
            and self.status in {"COMPLETED", "FAILED"}
        ):
            replay = True
        terminal_operation = (
            op in {"renew", "graph-complete", "retry"}
            and self.status in {"COMPLETED", "FAILED"}
            and not self.graph_finalized
        )
        if not replay and (
            body["leaseToken"] != self.lease
            or self.now > self.until
            or (self.status != "RUNNING" and not terminal_operation)
        ):
            return httpx.Response(409, json=envelope(None, 409, "LEASE_LOST"))
        data = {"jobId": "job-1"}
        if op == "renew":
            self.until = self.now + 180_000
            data["leaseUntil"] = self.until
        elif op == "gather":
            data.update(inputHash="a" * 64, ready=self.ready, artifactId=self.artifact)
        elif op == "compute":
            if self.compute_hook:
                await self.compute_hook()
            reused = self.artifact is not None
            if not reused:
                self.artifact = "artifact-1"
                self.compute_count += 1
            if not self.ready:
                self.execution = self.confirmation = False
            data.update(artifactId=self.artifact, reused=reused)
        elif op == "validate":
            assert body["artifactId"] == self.artifact
            data.update(
                artifactId=self.artifact,
                valid=self.valid,
                errorCode=None if self.valid else "VALIDATION_FAILED",
            )
        elif op == "commit":
            assert self.valid and body["artifactId"] == self.artifact
            if self.result is None:
                self.result = self.artifact
                self.action_count += int(self.execution)
            if self.commit_hook:
                self.commit_hook()
            data.update(
                artifactId=self.artifact,
                resultId=self.result,
                status="RUNNING",
                waitFor=self.wait_for(),
            )
        elif op == "park":
            assert body["artifactId"] == self.artifact
            if self.park_hook:
                await self.park_hook(body["interruptId"])
            wait = body["waitFor"]
            answered = (
                self.approval is not None
                if wait == "CONFIRMATION"
                else self.receipt is not None
            )
            self.status = f"{wait}_READY" if answered else f"WAITING_{wait}"
            self.lease = None
            data["status"] = self.status
        elif op == "complete":
            assert body["artifactId"] == self.artifact
            if self.status in {"COMPLETED", "FAILED", "UNCERTAIN"}:
                wait = "NONE"  # Explicit readonly replay, never reset finalized/lease.
            else:
                wait = self.wait_for()
                self.status = (
                    "RUNNING"
                    if wait != "NONE"
                    else (
                        "UNCERTAIN"
                        if self.receipt == "UNKNOWN"
                        else "FAILED"
                        if self.receipt == "FAILED"
                        else "COMPLETED"
                    )
                )
                if self.status in {"COMPLETED", "FAILED"}:
                    self.graph_finalized = False
            data.update(status=self.status, resultId=self.result, waitFor=wait)
        elif op == "graph-complete":
            assert body["artifactId"] == self.artifact and self.status in {
                "COMPLETED",
                "FAILED",
            }
            self.graph_finalized, self.lease = True, None
            data.update(status=self.status, graphFinalized=True)
        elif op == "retry":
            assert body["errorCode"] == api_error_code(body["errorCode"])
            if terminal_operation:
                return httpx.Response(409, json=envelope(None, 409, "JOB_NOT_RUNNABLE"))
            self.status, self.lease = "RETRY", None
            if body["errorCode"] == "VALIDATION_FAILED":
                self.status = "FAILED"
            self.last_retry = body["errorCode"]
            data.update(
                status=self.status,
                nextAttemptAt=self.now + 5000 if self.status == "RETRY" else None,
            )
        else:
            raise AssertionError(f"unexpected operation {op}")
        self.phases.append(op)
        if op in self.drop_after:
            self.drop_after.remove(op)
            raise httpx.ReadError(
                "synthetic lost ACK secret must not escape", request=request
            )
        return httpx.Response(200, json=envelope(data))


@asynccontextmanager
async def components(path, peer, **worker_options):
    connection = await aiosqlite.connect(path)
    saver = AutomationCheckpointer(connection, serde=STRICT_CHECKPOINT_SERIALIZER)
    await saver.setup()
    graphs = build_automation_graphs(saver)
    client = AutomationAPIClient(
        "http://api:9100", SecretStr(TOKEN), transport=httpx.MockTransport(peer.handle)
    )
    worker = AutomationWorker(client, graphs, **worker_options)
    try:
        yield client, graphs, worker, saver
    finally:
        await worker.stop()
        await client.close()
        await connection.close()


@pytest.mark.parametrize("kind", KINDS)
def test_named_graph_real_interrupt_restart_fresh_lease_and_no_private_state(
    tmp_path, kind
):
    async def scenario():
        peer = FakeAutomationAPI(kind)
        path = tmp_path / "career.sqlite3"
        async with components(path, peer) as (client, graphs, worker, _):
            graph = graphs[kind]
            assert graph.name == f"unified_{kind.lower()}"
            claim = await client.claim("first")

            async def durable_park(interrupt_id):
                state = await graph.aget_state(worker.graph_config(claim))
                assert state.interrupts[0].id == interrupt_id
                assert state.next == (f"{kind.lower()}_wait_execution",)

            peer.park_hook = durable_park
            await worker.process(claim)
            assert peer.status == "WAITING_EXECUTION"
            assert peer.phases == ["gather", "compute", "validate", "commit", "park"]
            assert worker.last_completed_at is None
            peer.park_hook = None
        peer.acknowledge()
        async with components(path, peer) as (client, graphs, worker, _):
            resumed = await client.claim("second")
            assert resumed.leaseToken != claim.leaseToken
            await worker.process(resumed)
            assert peer.status == "COMPLETED"
            assert worker.last_completed_at
            assert peer.compute_count == peer.action_count == 1
            state = await graphs[kind].aget_state(worker.graph_config(resumed))
            assert not state.next and not state.interrupts
            assert set(state.values) == {
                "job_id",
                "kind",
                "revision",
                "input_hash",
                "artifact_id",
                "result_id",
                "wait_for",
                "status",
                "terminal_reconcile",
            }
        raw = path.read_bytes()
        for private in (
            TOKEN,
            LEASE,
            "leaseToken",
            "resumeData",
            "requiresExecution",
            "approvals",
        ):
            assert private.encode() not in raw

    asyncio.run(scenario())


@pytest.mark.parametrize("delete_checkpoint", [False, True])
@pytest.mark.parametrize("early_receipt", [False, True])
def test_approval_then_execution_and_missing_checkpoint_reconstruction(
    tmp_path, delete_checkpoint, early_receipt
):
    async def scenario():
        peer = FakeAutomationAPI(confirmation=True)
        path = tmp_path / "approval.sqlite3"
        async with components(path, peer) as (client, graphs, worker, saver):
            claim = await client.claim("first")
            await worker.process(claim)
            assert peer.status == "WAITING_CONFIRMATION"
            if delete_checkpoint:
                await saver.adelete_thread("automation:job-1")
                assert not (
                    await graphs["REPLY"].aget_state(worker.graph_config(claim))
                ).values
        peer.approve()
        if early_receipt:
            peer.acknowledge()
        async with components(path, peer) as (client, graphs, worker, _):
            await worker.process(await client.claim("after-approval"))
            if not early_receipt:
                assert peer.status == "WAITING_EXECUTION"
                peer.acknowledge()
                await worker.process(await client.claim("after-execution"))
            assert peer.status == "COMPLETED"
            assert peer.action_count == peer.compute_count == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("decision", ["APPROVE", "DECLINE"])
def test_early_approval_before_durable_park_is_not_lost(tmp_path, decision):
    async def scenario():
        peer = FakeAutomationAPI(confirmation=True, execution=False)
        async with components(tmp_path / "early.sqlite3", peer) as (
            client,
            _,
            worker,
            _,
        ):

            async def early(_):
                peer.approve(decision)

            peer.park_hook = early
            await worker.process(await client.claim("first"))
            assert peer.status == "CONFIRMATION_READY"
            await worker.process(await client.claim("second"))
            assert peer.status == "COMPLETED" and peer.action_count == 0

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "op", ["gather", "compute", "validate", "commit", "park", "complete"]
)
def test_lost_http_ack_does_not_duplicate_artifact_or_action(tmp_path, op):
    async def scenario():
        peer = FakeAutomationAPI()
        peer.drop_after.add(op)
        async with components(tmp_path / "lost.sqlite3", peer) as (
            client,
            _,
            worker,
            _,
        ):
            await worker.process(await client.claim("first"))
            assert peer.status == "WAITING_EXECUTION"
            peer.acknowledge()
            await worker.process(await client.claim("second"))
            assert peer.status == "COMPLETED"
            assert peer.compute_count == peer.action_count == 1

    asyncio.run(scenario())


def test_saved_before_checkpoint_crash_resumes_idempotent_commit(tmp_path):
    async def scenario():
        peer = FakeAutomationAPI()
        path = tmp_path / "crash.sqlite3"

        def crash_after_save():
            peer.commit_hook = None
            raise sqlite3.OperationalError("synthetic disk failure")

        peer.commit_hook = crash_after_save
        async with components(path, peer) as (client, _, worker, _):
            with pytest.raises(AutomationAPIError, match="CHECKPOINT_UNAVAILABLE"):
                await worker.process(await client.claim("first"))
            assert peer.result and peer.status == "RETRY"
        async with components(path, peer) as (client, _, worker, _):
            await worker.process(await client.claim("second"))
            assert peer.status == "WAITING_EXECUTION"
            assert peer.compute_count == peer.action_count == 1
            assert peer.calls["compute"] == 1 and peer.calls["commit"] == 2

    asyncio.run(scenario())


def test_lease_loss_cancels_model_node_without_terminal_checkpoint(tmp_path):
    async def scenario():
        peer = FakeAutomationAPI()
        entered = asyncio.Event()

        async def slow_compute():
            entered.set()
            await asyncio.Event().wait()

        peer.compute_hook = slow_compute
        peer.renew_hook = entered.wait
        peer.fail_before["renew"] = (409, "LEASE_LOST")
        path = tmp_path / "lease.sqlite3"
        async with components(path, peer, renew_seconds=0.02) as (
            client,
            graphs,
            worker,
            _,
        ):
            first = await client.claim("first")
            await worker.process(first)
            assert entered.is_set() and peer.calls["retry"] == 0
            state = await graphs["REPLY"].aget_state(worker.graph_config(first))
            assert state.next == ("reply_compute",)
        peer.now += 200_000
        peer.compute_hook = None
        peer.fail_before.clear()
        async with components(path, peer) as (client, _, worker, _):
            second = await client.claim("second")
            assert second.leaseToken != first.leaseToken
            await worker.process(second)
            assert peer.status == "WAITING_EXECUTION" and peer.action_count == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("receipt", ["FAILED", "UNKNOWN", "ACKNOWLEDGED"])
def test_completion_reports_real_receipt_status_and_late_ack_never_sends(
    tmp_path, receipt
):
    async def scenario():
        peer = FakeAutomationAPI()
        async with components(tmp_path / "receipt.sqlite3", peer) as (
            client,
            _,
            worker,
            _,
        ):
            await worker.process(await client.claim("first"))
            peer.acknowledge(receipt)
            await worker.process(await client.claim("second"))
            assert (
                peer.status
                == {
                    "FAILED": "FAILED",
                    "UNKNOWN": "UNCERTAIN",
                    "ACKNOWLEDGED": "COMPLETED",
                }[receipt]
            )
            assert bool(worker.last_completed_at) == (receipt == "ACKNOWLEDGED")
            if receipt == "UNKNOWN":
                peer.acknowledge()
                await worker.process(await client.claim("late-ack"))
                assert peer.status == "COMPLETED"
            assert peer.compute_count == peer.action_count == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("ready", [True, False])
def test_no_action_and_missing_materials_still_pass_all_graph_stages(tmp_path, ready):
    async def scenario():
        peer = FakeAutomationAPI(execution=not ready, ready=ready)
        async with components(tmp_path / "no-action.sqlite3", peer) as (
            client,
            _,
            worker,
            _,
        ):
            await worker.process(await client.claim("first"))
            assert peer.status == "COMPLETED" and peer.action_count == 0
            assert peer.phases == [
                "gather",
                "compute",
                "validate",
                "commit",
                "complete",
                "graph-complete",
            ]

    asyncio.run(scenario())


def test_invalid_evidence_never_publishes_or_creates_actions(tmp_path):
    async def scenario():
        peer = FakeAutomationAPI()
        peer.valid = False
        async with components(tmp_path / "invalid.sqlite3", peer) as (
            client,
            _,
            worker,
            _,
        ):
            await worker.process(await client.claim("first"))
            assert peer.status == "FAILED" and peer.action_count == 0
            assert peer.calls["commit"] == peer.calls["complete"] == 0
            assert worker.last_error == "VALIDATION_FAILED"

    asyncio.run(scenario())


def test_heartbeat_remains_live_during_long_compute_and_stops_cleanly(tmp_path):
    async def scenario():
        peer = FakeAutomationAPI()
        entered = asyncio.Event()

        async def slow():
            entered.set()
            await asyncio.Event().wait()

        peer.compute_hook = slow
        async with components(
            tmp_path / "heartbeat.sqlite3",
            peer,
            scan_seconds=0.01,
            heartbeat_seconds=0.01,
        ) as (_, _, worker, _):
            worker.last_error = "CHECKPOINT_MISMATCH"
            worker.start()
            await asyncio.wait_for(entered.wait(), timeout=2)
            await asyncio.sleep(0.06)
            assert peer.calls["heartbeat"] >= 3
            assert "CHECKPOINT_UNAVAILABLE" in peer.heartbeat_errors
            assert worker.ready and worker.last_completed_at is None
            await worker.stop()
            count = peer.calls["heartbeat"]
            await asyncio.sleep(0.03)
            assert peer.calls["heartbeat"] == count and not worker.running

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "code, expected",
    [
        ("INTERNAL_UNAUTHORIZED", "INTERNAL_ERROR"),
        ("INVALID_RESPONSE", "INTERNAL_ERROR"),
        ("INPUT_CHANGED", "INTERNAL_ERROR"),
        ("CHECKPOINT_MISMATCH", "CHECKPOINT_UNAVAILABLE"),
        ("MODEL_TIMEOUT", "MODEL_TIMEOUT"),
    ],
)
def test_heartbeat_and_retry_error_codes_are_contract_bounded(code, expected):
    assert api_error_code(code) == expected


def test_deadline_releases_job_without_a_false_completion(tmp_path):
    async def scenario():
        peer = FakeAutomationAPI()

        async def slow():
            await asyncio.Event().wait()

        peer.compute_hook = slow
        async with components(
            tmp_path / "deadline.sqlite3", peer, job_timeout_seconds=0.03
        ) as (client, _, worker, _):
            with pytest.raises(AutomationAPIError, match="WORKER_DEADLINE"):
                await worker.process(await client.claim("first"))
            assert (
                peer.last_retry == "WORKER_DEADLINE"
                and worker.last_completed_at is None
            )

    asyncio.run(scenario())
