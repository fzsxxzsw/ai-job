"""Named durable graphs; no node executes browser actions or stores private input."""

import asyncio
from dataclasses import dataclass
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import interrupt

from job_helper_agent.automation_client import (
    AutomationAPIClient,
    AutomationAPIError,
    AutomationClaim,
    JobKind,
    WaitFor,
)

GRAPH_VERSION = "unified-career-graph-v1"
KINDS = ("REPLY", "APPLICATION", "CAREER_REVIEW")


class AutomationState(TypedDict, total=False):
    job_id: str
    kind: JobKind
    revision: int
    input_hash: str
    artifact_id: str | None
    result_id: str | None
    wait_for: WaitFor
    status: str
    terminal_reconcile: bool


@dataclass(frozen=True)
class AutomationRuntime:
    client: AutomationAPIClient
    claim: AutomationClaim


def matches_claim(state, claim):
    return (
        state.get("job_id"),
        state.get("kind"),
        state.get("revision"),
        state.get("input_hash"),
    ) == (claim.jobId, claim.kind, claim.revision, claim.inputHash)


async def bounded_request(operation):
    for attempt in range(3):
        try:
            return await operation()
        except AutomationAPIError as error:
            if not error.retryable or attempt == 2:
                raise
            await asyncio.sleep(0.5 * 2**attempt)
    raise AssertionError("unreachable")


def checked_runtime(state, runtime):
    context = runtime.context
    if not matches_claim(state, context.claim):
        raise AutomationAPIError("CHECKPOINT_MISMATCH")
    return context


async def gather(state: AutomationState, runtime: Runtime[AutomationRuntime]):
    context = checked_runtime(state, runtime)
    result = await bounded_request(lambda: context.client.gather(context.claim))
    # ready=False is an incomplete decision, not permission to fabricate inputs.
    # API compute persists the honest no-action artifact for that case.
    return {"artifact_id": result.artifactId, "status": "COLLECTED"}


async def compute(state: AutomationState, runtime: Runtime[AutomationRuntime]):
    context = checked_runtime(state, runtime)
    result = await bounded_request(lambda: context.client.compute(context.claim))
    return {"artifact_id": result.artifactId, "status": "COMPUTED"}


async def validate(state: AutomationState, runtime: Runtime[AutomationRuntime]):
    context = checked_runtime(state, runtime)
    result = await bounded_request(
        lambda: context.client.validate(context.claim, state["artifact_id"])
    )
    return {"status": "VALIDATED" if result.valid else "VALIDATION_FAILED"}


async def commit(state: AutomationState, runtime: Runtime[AutomationRuntime]):
    context = checked_runtime(state, runtime)
    result = await bounded_request(
        lambda: context.client.commit(context.claim, state["artifact_id"])
    )
    return {
        "status": "PERSISTED",
        "result_id": result.resultId,
        "wait_for": result.waitFor,
    }


def pause_value(state):
    return {
        "jobId": state["job_id"],
        "revision": state["revision"],
        "inputHash": state["input_hash"],
        "artifactId": state["artifact_id"],
        "resultId": state["result_id"],
        "waitFor": state["wait_for"],
    }


def wait_result(state: AutomationState, runtime: Runtime[AutomationRuntime]):
    checked_runtime(state, runtime)
    expected = pause_value(state)
    resumed = interrupt(expected)
    # Only bound references enter resume writes. Receipt details and tokens remain
    # in API/runtime; complete independently proves required receipts/approvals.
    if resumed != expected:
        raise AutomationAPIError("INVALID_RESPONSE")
    return {"status": "RESUMED"}


async def finalize(state: AutomationState, runtime: Runtime[AutomationRuntime]):
    context = checked_runtime(state, runtime)
    result = await bounded_request(
        lambda: context.client.complete(context.claim, state["artifact_id"])
    )
    if context.claim.executionMode == "RECONCILE_TERMINAL" and result.status not in {
        "COMPLETED",
        "FAILED",
    }:
        raise AutomationAPIError("INVALID_RESPONSE")
    return {
        "status": result.status,
        "result_id": result.resultId,
        "wait_for": result.waitFor,
    }


def build_automation_graphs(checkpointer):
    graphs = {}
    for kind in KINDS:
        prefix = kind.lower()
        builder = StateGraph(AutomationState, context_schema=AutomationRuntime)
        for name, node in (
            ("gather", gather),
            ("compute", compute),
            ("validate", validate),
            ("persist", commit),
            ("wait_execution", wait_result),
            ("wait_confirmation", wait_result),
            ("finalize", finalize),
        ):
            builder.add_node(f"{prefix}_{name}", node)
        builder.add_conditional_edges(
            START,
            lambda state: "terminal" if state.get("terminal_reconcile") else "normal",
            {"terminal": f"{prefix}_finalize", "normal": f"{prefix}_gather"},
        )
        builder.add_edge(f"{prefix}_gather", f"{prefix}_compute")
        builder.add_edge(f"{prefix}_compute", f"{prefix}_validate")
        builder.add_conditional_edges(
            f"{prefix}_validate",
            lambda state: "valid" if state["status"] == "VALIDATED" else "invalid",
            {"valid": f"{prefix}_persist", "invalid": END},
        )
        destinations = {
            "EXECUTION": f"{prefix}_wait_execution",
            "CONFIRMATION": f"{prefix}_wait_confirmation",
            "NONE": f"{prefix}_finalize",
        }
        builder.add_conditional_edges(
            f"{prefix}_persist", lambda state: state["wait_for"], destinations
        )
        builder.add_edge(f"{prefix}_wait_execution", f"{prefix}_finalize")
        builder.add_edge(f"{prefix}_wait_confirmation", f"{prefix}_finalize")
        builder.add_conditional_edges(
            f"{prefix}_finalize",
            lambda state: state["wait_for"],
            {**destinations, "NONE": END},
        )
        graphs[kind] = builder.compile(
            checkpointer=checkpointer, name=f"unified_{prefix}"
        )
    return graphs
