import asyncio

import pytest
from job_helper_agent.outcome_client import OutcomeAPIError
from test_outcome_client import LEASE, TOKEN
from test_outcome_worker import FakeOutcomeAPI, components

GRAPH_CONFIG = {"configurable": {"thread_id": "outcome:job-1"}}


@pytest.mark.parametrize(
    "operation,kind",
    [
        ("analyze", "FACTS_ONLY"),
        ("analyze", "REJECTION_CAUSES"),
        ("validate", "FACTS_ONLY"),
        ("commit", "FACTS_ONLY"),
        ("park", "FACTS_ONLY"),
        ("complete", "FACTS_ONLY"),
    ],
)
def test_node_lease_loss_resumes_with_new_lease_after_sqlite_restart(
    tmp_path, operation, kind
):
    async def scenario():
        peer = FakeOutcomeAPI(kind=kind)
        path = tmp_path / "lease-node.sqlite3"
        async with components(path, peer) as (client, graph, worker):
            if operation == "complete":
                await worker.process(await client.claim("first-start"))
                peer.give_feedback()
            claim = await client.claim("old-lease")
            peer.fail_before[operation] = (409, "LEASE_LOST")
            await worker.process(claim)
            snapshot = await graph.aget_state(GRAPH_CONFIG)
            assert snapshot.values["status"] != "SUPERSEDED"
            assert snapshot.next
            assert peer.calls["retry"] == 0
            assert peer.status == "RUNNING"
        peer.fail_before.clear()
        peer.now = peer.until + 1
        async with components(path, peer) as (client, graph, worker):
            fresh = await client.claim("new-process")
            assert fresh.jobId == claim.jobId and fresh.revision == claim.revision
            assert fresh.leaseToken != claim.leaseToken
            await worker.process(fresh)
            if operation != "complete":
                assert peer.status == "WAITING_CONFIRMATION"
                peer.give_feedback()
                await worker.process(await client.claim("human-resume"))
            assert peer.status == "COMPLETED"
            assert peer.report_count == peer.analysis_count == 1
            snapshot = await graph.aget_state(GRAPH_CONFIG)
            assert snapshot.values["status"] == "COMPLETED"
            assert not snapshot.next
        raw = path.read_bytes()
        assert TOKEN.encode() not in raw and LEASE.encode() not in raw

    asyncio.run(scenario())


@pytest.mark.parametrize("operation", ["analyze", "commit"])
def test_renewal_loss_after_api_effect_cancels_ack_then_recovers(tmp_path, operation):
    async def scenario():
        peer = FakeOutcomeAPI()
        cancelled = asyncio.Event()
        effect_done = asyncio.Event()
        original_handler = peer.handle

        async def delayed_ack(request):
            response = await original_handler(request)
            if request.url.path.endswith("/" + operation):
                effect_done.set()
                peer.fail_before["renew"] = (409, "LEASE_LOST")
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.set()
            return response

        peer.handle = delayed_ack
        path = tmp_path / "renew-race.sqlite3"
        async with components(path, peer, renew_seconds=0.01) as (
            client,
            graph,
            worker,
        ):
            await asyncio.wait_for(worker.process(await client.claim("old")), 2)
            assert effect_done.is_set() and cancelled.is_set()
            snapshot = await graph.aget_state(GRAPH_CONFIG)
            assert snapshot.next and snapshot.values["status"] != "SUPERSEDED"
            assert peer.calls["retry"] == 0
        peer.handle = original_handler
        peer.fail_before.clear()
        peer.now = peer.until + 1
        async with components(path, peer) as (client, graph, worker):
            await worker.process(await client.claim("replacement"))
            assert peer.status == "WAITING_CONFIRMATION"
            assert peer.analysis_count == peer.report_count == 1

    asyncio.run(scenario())


@pytest.mark.parametrize("operation", ["analyze", "validate", "commit", "complete"])
def test_business_revision_supersession_remains_terminal(tmp_path, operation):
    async def scenario():
        peer = FakeOutcomeAPI()
        async with components(tmp_path / "superseded.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            if operation == "complete":
                await worker.process(await client.claim("start"))
                peer.give_feedback()
            peer.fail_before[operation] = (409, "REVISION_SUPERSEDED")
            await worker.process(await client.claim("obsolete"))
            snapshot = await graph.aget_state(GRAPH_CONFIG)
            assert snapshot.values["status"] == "SUPERSEDED"
            assert snapshot.values["artifact_id"] is None
            assert not snapshot.next and not snapshot.interrupts
            assert peer.calls["retry"] == 0

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "server_code,error_code",
    [
        ("INPUT_MISMATCH", "INPUT_MISMATCH"),
        ("ARTIFACT_MISMATCH", "ARTIFACT_MISMATCH"),
        ("unknown-private-upstream-conflict", "UNEXPECTED_CONFLICT"),
    ],
)
def test_conflict_is_a_visible_safe_failure_and_does_not_poison_checkpoint(
    tmp_path, server_code, error_code
):
    async def scenario():
        peer = FakeOutcomeAPI()
        async with components(tmp_path / "conflict.sqlite3", peer) as (
            client,
            graph,
            worker,
        ):
            peer.fail_before["validate"] = (409, server_code)
            with pytest.raises(OutcomeAPIError, match=error_code):
                await worker.process(await client.claim("worker"))
            snapshot = await graph.aget_state(GRAPH_CONFIG)
            assert snapshot.values["status"] != "SUPERSEDED" and snapshot.next
            assert peer.last_retry == "INTERNAL_FAILURE"
            assert peer.report_count == 0
            peer.fail_before.clear()
            await worker.process(await client.claim("recovered"))
            assert peer.status == "WAITING_CONFIRMATION"
            assert peer.report_count == peer.analysis_count == 1

    asyncio.run(scenario())
