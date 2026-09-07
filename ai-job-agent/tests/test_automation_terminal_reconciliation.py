import asyncio
import json
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from job_helper_agent.automation_client import (
    AutomationAPIClient,
    AutomationAPIError,
    AutomationClaim,
)
from pydantic import SecretStr, ValidationError
from test_automation_worker import (
    TOKEN,
    FakeAutomationAPI,
    claim_data,
    components,
    envelope,
)


@pytest.mark.parametrize("receipt", ["ACKNOWLEDGED", "FAILED"])
@pytest.mark.parametrize("crash_at", ["after-api-complete", "before-graph-ack"])
@pytest.mark.parametrize("delete_checkpoint", [False, True])
def test_real_process_death_recovers_terminal_graph_without_recompute(
    tmp_path, receipt, crash_at, delete_checkpoint
):
    helper = Path(__file__).with_name("_automation_crash_process.py")
    crashed = subprocess.run(
        [sys.executable, str(helper), str(tmp_path), "crash", receipt, crash_at],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert crashed.returncode == (71 if crash_at == "after-api-complete" else 72), (
        crashed.stderr
    )
    persisted = json.loads((tmp_path / "api.json").read_text(encoding="utf-8"))
    assert persisted["status"] == (
        "COMPLETED" if receipt == "ACKNOWLEDGED" else "FAILED"
    )
    assert persisted["graph_finalized"] is False
    assert persisted["compute_count"] == persisted["action_count"] == 1

    async def inspect_crash():
        peer = FakeAutomationAPI()
        async with components(tmp_path / "checkpoints.sqlite3", peer) as (
            _,
            graphs,
            _,
            saver,
        ):
            state = await graphs["REPLY"].aget_state(
                {"configurable": {"thread_id": "automation:job-1"}}
            )
            assert state.next == (
                ("reply_finalize",) if crash_at == "after-api-complete" else ()
            )
            if delete_checkpoint:
                await saver.adelete_thread("automation:job-1")
                assert not (
                    await graphs["REPLY"].aget_state(
                        {"configurable": {"thread_id": "automation:job-1"}}
                    )
                ).values

    asyncio.run(inspect_crash())
    recovered = subprocess.run(
        [sys.executable, str(helper), str(tmp_path), "recover", receipt, crash_at],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert recovered.returncode == 0, recovered.stderr
    proof = json.loads((tmp_path / "proof.json").read_text(encoding="utf-8"))
    assert proof["next"] == [] and proof["graphFinalized"] is True
    assert proof["modelCalls"] == proof["actionCount"] == 1
    assert proof["gatherCalls"] == proof["computeCalls"] == proof["commitCalls"] == 1
    assert bool(proof["completedAt"]) == (receipt == "ACKNOWLEDGED")


def test_graph_complete_lost_ack_replays_only_after_end(tmp_path):
    async def scenario():
        peer = FakeAutomationAPI(execution=False)
        peer.drop_after.add("graph-complete")
        async with components(tmp_path / "ack.sqlite3", peer) as (
            client,
            graph,
            worker,
            _,
        ):
            claim = await client.claim("worker")
            await worker.process(claim)
            assert peer.graph_finalized and peer.calls["graph-complete"] == 2
            assert peer.calls["complete"] == 1
            assert peer.compute_count == 1
            state = await graph["REPLY"].aget_state(worker.graph_config(claim))
            assert not state.next and state.values["status"] == "COMPLETED"

    asyncio.run(scenario())


def test_reconciliation_does_not_overwrite_an_existing_unrelated_wait(tmp_path):
    async def scenario():
        peer = FakeAutomationAPI()
        async with components(tmp_path / "mismatch.sqlite3", peer) as (
            client,
            graphs,
            worker,
            _,
        ):
            await worker.process(await client.claim("first"))
            peer.status, peer.graph_finalized = "COMPLETED", False
            peer.now += 200_000
            claim = await client.claim("reconcile")
            assert claim.executionMode == "RECONCILE_TERMINAL"
            with pytest.raises(AutomationAPIError, match="CHECKPOINT_MISMATCH"):
                await worker.process(claim)
            state = await graphs["REPLY"].aget_state(worker.graph_config(claim))
            assert state.next == ("reply_wait_execution",)
            assert peer.calls["complete"] == peer.calls["graph-complete"] == 0
            assert peer.status == "COMPLETED" and not peer.graph_finalized
            assert peer.compute_count == peer.action_count == 1

    asyncio.run(scenario())


def test_terminal_business_state_can_renew_until_durable_graph_ack(tmp_path):
    async def scenario():
        peer = FakeAutomationAPI(execution=False)
        async with components(tmp_path / "renew.sqlite3", peer) as (client, _, _, _):
            claim = await client.claim("worker")
            await client.gather(claim)
            artifact = (await client.compute(claim)).artifactId
            await client.validate(claim, artifact)
            await client.commit(claim, artifact)
            await client.complete(claim, artifact)
            assert peer.status == "COMPLETED" and not peer.graph_finalized
            assert (await client.renew(claim)).leaseUntil > 0
            assert await client.claim("other-worker") is None

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "mutation", [{"artifactId": None}, {"resultId": None}, {"phase": "COLLECTING"}]
)
def test_terminal_reconcile_claim_requires_durable_bound_references(mutation):
    data = claim_data(
        executionMode="RECONCILE_TERMINAL",
        artifactId="artifact-1",
        resultId="artifact-1",
        phase="FINALIZING",
    )
    data.update(mutation)
    with pytest.raises(ValidationError):
        AutomationClaim.model_validate(data)


@pytest.mark.parametrize(
    "data",
    [
        {"jobId": "other-job", "status": "COMPLETED", "graphFinalized": True},
        {"jobId": "job-1", "status": "COMPLETED", "graphFinalized": False},
        {"jobId": "job-1", "status": "RUNNING", "graphFinalized": True},
    ],
)
def test_graph_ack_response_is_strict_and_job_bound(data):
    async def scenario():
        client = AutomationAPIClient(
            "http://api:9100",
            SecretStr(TOKEN),
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, json=envelope(data))
            ),
        )
        try:
            with pytest.raises(AutomationAPIError, match="INVALID_RESPONSE"):
                await client.graph_complete(
                    AutomationClaim.model_validate(claim_data()), "artifact-1"
                )
        finally:
            await client.close()

    asyncio.run(scenario())
