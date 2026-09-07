"""Subprocess-only synthetic API persistence and abrupt process-death fixture."""

import asyncio
import json
import os
import sys
from collections import Counter
from pathlib import Path

from test_automation_worker import FakeAutomationAPI, components


class PersistedPeer(FakeAutomationAPI):
    FIELDS = (
        "kind",
        "execution",
        "confirmation",
        "ready",
        "valid",
        "status",
        "lease",
        "generation",
        "artifact",
        "result",
        "receipt",
        "approval",
        "now",
        "until",
        "calls",
        "compute_count",
        "action_count",
        "graph_finalized",
    )

    def __init__(self, path, crash_at):
        super().__init__()
        self.path, self.crash_at = path, crash_at
        if path.exists():
            for key, value in json.loads(path.read_text(encoding="utf-8")).items():
                setattr(self, key, Counter(value) if key == "calls" else value)

    def persist(self):
        # API fixtures survive os._exit as business storage does; not a mock
        # exception that lets the LangGraph task unwind or write a final state.
        with self.path.open("w", encoding="utf-8") as stream:
            json.dump({key: getattr(self, key) for key in self.FIELDS}, stream)
            stream.flush()
            os.fsync(stream.fileno())

    async def handle(self, request):
        operation = request.url.path.rsplit("/", 1)[-1]
        if self.crash_at == "before-graph-ack" and operation == "graph-complete":
            self.persist()
            os._exit(72)
        response = await super().handle(request)
        self.persist()
        if self.crash_at == "after-api-complete" and operation == "complete":
            os._exit(71)
        return response


async def main():
    directory, mode, receipt, crash_at = sys.argv[1:]
    directory = Path(directory)
    peer = PersistedPeer(directory / "api.json", crash_at if mode == "crash" else None)
    async with components(directory / "checkpoints.sqlite3", peer) as (
        client,
        graphs,
        worker,
        _,
    ):
        if mode == "crash":
            await worker.process(await client.claim("original-process"))
            peer.acknowledge(receipt)
            peer.persist()
        else:
            peer.now += 200_000
            peer.persist()
        claim = await client.claim("terminal-process")
        if mode == "recover":
            assert claim.executionMode == "RECONCILE_TERMINAL"
            assert peer.status in {"COMPLETED", "FAILED"}
        await worker.process(claim)
        if mode == "crash":
            raise AssertionError("crash injection did not trigger")
        state = await graphs[claim.kind].aget_state(worker.graph_config(claim))
        assert not state.next and not state.interrupts
        assert state.values["status"] == peer.status
        assert peer.graph_finalized and peer.lease is None
        assert peer.compute_count == peer.action_count == 1
        assert await client.claim("duplicate-reconciliation") is None
        (directory / "proof.json").write_text(
            json.dumps(
                {
                    "status": peer.status,
                    "graphFinalized": peer.graph_finalized,
                    "next": list(state.next),
                    "modelCalls": peer.compute_count,
                    "actionCount": peer.action_count,
                    "gatherCalls": peer.calls["gather"],
                    "computeCalls": peer.calls["compute"],
                    "commitCalls": peer.calls["commit"],
                    "completedAt": worker.last_completed_at,
                }
            ),
            encoding="utf-8",
        )


if __name__ == "__main__":
    asyncio.run(main())
