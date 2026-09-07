"""Recoverable report orchestration; the API remains the only business engine."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import interrupt

from job_helper_agent.outcome_client import (
    AnalysisKind,
    OutcomeAPIClient,
    OutcomeAPIError,
    OutcomeClaim,
)


class OutcomeState(TypedDict, total=False):
    job_id: str
    case_id: str
    revision: int
    input_hash: str
    analysis_kind: AnalysisKind
    artifact_id: str | None
    report_id: str
    feedback_id: str
    status: Literal["PENDING", "SAVED", "COMPLETED", "SUPERSEDED", "FAILED"]


@dataclass(frozen=True)
class OutcomeRuntime:
    # Runtime.context is not serialized as a graph state or configurable metadata.
    client: OutcomeAPIClient
    claim: OutcomeClaim


def matches_claim(state: OutcomeState, claim: OutcomeClaim) -> bool:
    return (
        state.get("job_id"),
        state.get("case_id"),
        state.get("revision"),
        state.get("input_hash"),
        state.get("analysis_kind"),
    ) == (
        claim.jobId,
        claim.caseId,
        claim.revision,
        claim.inputHash,
        claim.context.analysisKind,
    )


async def bounded_request[T](operation: Callable[[], Awaitable[T]]) -> T:
    for attempt in range(3):
        try:
            return await operation()
        except OutcomeAPIError as error:
            if not error.retryable or attempt == 2:
                raise
            await asyncio.sleep(0.5 * 2**attempt)
    raise AssertionError("unreachable")


def load_projection(state: OutcomeState, runtime: Runtime[OutcomeRuntime]) -> dict:
    if not matches_claim(state, runtime.context.claim):
        raise OutcomeAPIError("CHECKPOINT_MISMATCH")
    return {"status": "PENDING"}


async def cache_artifact(state: OutcomeState, runtime: Runtime[OutcomeRuntime]) -> dict:
    context = runtime.context
    if not matches_claim(state, context.claim):
        raise OutcomeAPIError("CHECKPOINT_MISMATCH")
    # A committed API artifact survives a graph checkpoint failure or a new lease.
    artifact_id = context.claim.artifactId or state.get("artifact_id")
    if artifact_id:
        return {"artifact_id": artifact_id}
    try:
        artifact_id = await bounded_request(
            lambda: context.client.analyze(context.claim)
        )
    except OutcomeAPIError as error:
        if error.superseded:
            return {"status": "SUPERSEDED", "artifact_id": None}
        raise
    return {"artifact_id": artifact_id}


async def publish_report(state: OutcomeState, runtime: Runtime[OutcomeRuntime]) -> dict:
    context = runtime.context
    if not matches_claim(state, context.claim):
        raise OutcomeAPIError("CHECKPOINT_MISMATCH")
    artifact_id = state.get("artifact_id")
    if not artifact_id:
        raise OutcomeAPIError("INVALID_CHECKPOINT")
    try:
        publication = await bounded_request(
            lambda: context.client.commit(context.claim, artifact_id)
        )
    except OutcomeAPIError as error:
        if error.superseded:
            return {"status": "SUPERSEDED", "artifact_id": None}
        raise
    if not publication.isCurrent:
        return {"status": "SUPERSEDED", "artifact_id": None}
    return {"status": "SAVED", "report_id": publication.reportId}


async def validate_artifact(
    state: OutcomeState, runtime: Runtime[OutcomeRuntime]
) -> dict:
    context = runtime.context
    if not matches_claim(state, context.claim):
        raise OutcomeAPIError("CHECKPOINT_MISMATCH")
    artifact_id = state.get("artifact_id")
    if not artifact_id:
        raise OutcomeAPIError("INVALID_CHECKPOINT")
    try:
        valid = await bounded_request(
            lambda: context.client.validate(context.claim, artifact_id)
        )
    except OutcomeAPIError as error:
        if error.superseded:
            return {"status": "SUPERSEDED", "artifact_id": None}
        raise
    return {} if valid else {"status": "FAILED"}


def await_human(state: OutcomeState, runtime: Runtime[OutcomeRuntime]) -> dict:
    feedback = interrupt(
        {
            "jobId": state["job_id"],
            "reportId": state["report_id"],
            "revision": state["revision"],
        }
    )
    expected = runtime.context.claim.humanFeedback
    if (
        expected is None
        or feedback != expected.model_dump()
        or expected.reportId != state["report_id"]
    ):
        raise OutcomeAPIError("INVALID_HUMAN_FEEDBACK")
    return {"feedback_id": expected.feedbackId}


async def finish_confirmation(
    state: OutcomeState, runtime: Runtime[OutcomeRuntime]
) -> dict:
    context = runtime.context
    if not matches_claim(state, context.claim):
        raise OutcomeAPIError("CHECKPOINT_MISMATCH")
    expected = context.claim.humanFeedback
    if expected is None or state.get("feedback_id") != expected.feedbackId:
        raise OutcomeAPIError("INVALID_HUMAN_FEEDBACK")
    try:
        completed = await bounded_request(
            lambda: context.client.complete(context.claim, state["artifact_id"])
        )
    except OutcomeAPIError as error:
        if error.superseded:
            return {"status": "SUPERSEDED", "artifact_id": None}
        raise
    return {"status": "COMPLETED", "report_id": completed.reportId}


def analysis_route(state: OutcomeState) -> str:
    if state.get("status") == "SUPERSEDED":
        return END
    return (
        "rejection_causes"
        if state["analysis_kind"] == "REJECTION_CAUSES"
        else "facts_only"
    )


def validation_route(state: OutcomeState) -> str:
    return END if state.get("status") == "SUPERSEDED" else "validate_artifact"


def publication_route(state: OutcomeState) -> str:
    return END if state.get("status") in {"SUPERSEDED", "FAILED"} else "publish_report"


def confirmation_route(state: OutcomeState) -> str:
    return END if state.get("status") == "SUPERSEDED" else "await_human"


def build_outcome_graph(checkpointer):
    graph = StateGraph(OutcomeState, context_schema=OutcomeRuntime)
    graph.add_node("load_projection", load_projection)
    graph.add_node("facts_only", cache_artifact)
    graph.add_node("rejection_causes", cache_artifact)
    graph.add_node("validate_artifact", validate_artifact)
    graph.add_node("publish_report", publish_report)
    graph.add_node("await_human", await_human)
    graph.add_node("finish_confirmation", finish_confirmation)
    graph.add_edge(START, "load_projection")
    graph.add_conditional_edges("load_projection", analysis_route)
    graph.add_conditional_edges("facts_only", validation_route)
    graph.add_conditional_edges("rejection_causes", validation_route)
    graph.add_conditional_edges("validate_artifact", publication_route)
    graph.add_conditional_edges("publish_report", confirmation_route)
    graph.add_edge("await_human", "finish_confirmation")
    graph.add_edge("finish_confirmation", END)
    return graph.compile(checkpointer=checkpointer, name="application_outcomes")
