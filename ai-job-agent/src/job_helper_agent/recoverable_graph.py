import hashlib
import json
from typing import Literal, NotRequired, TypedDict
from uuid import NAMESPACE_URL, uuid5

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from job_helper_agent.decision_graph import (
    DecisionState,
    apply_keyword_policy,
    normalize_job,
)
from job_helper_agent.models import ApprovalDecision, Decision


class RecoverableState(DecisionState, total=False):
    run_id: str
    thread_id: str
    subject_ref: str
    request_id: str
    source_job_ref: str
    graph_version: str
    proposal_id: NotRequired[str]
    proposal: NotRequired[dict[str, object]]
    preview_hash: NotRequired[str]
    approval_decision: NotRequired[str]
    decision_request_id: NotRequired[str]
    approval_reason: NotRequired[str | None]
    result: NotRequired[dict[str, object]]


def _canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build_contact_proposal(state: RecoverableState) -> dict[str, object]:
    """Build an idempotent proposal. The node has no database or browser effects."""

    proposal_id = str(uuid5(NAMESPACE_URL, f"job-helper:proposal:{state['run_id']}"))
    preview = f"Request human-approved contact for job {state['source_job_ref']}"
    preview_source = {
        "action_kind": "CONTACT_JOB",
        "target_ref": state["source_job_ref"],
        "preview": preview,
    }
    preview_hash = hashlib.sha256(_canonical_json(preview_source).encode("utf-8")).hexdigest()
    proposal = {"proposal_id": proposal_id, **preview_source, "preview_hash": preview_hash}
    return {
        "proposal_id": proposal_id,
        "proposal": proposal,
        "preview_hash": preview_hash,
    }


def request_approval(state: RecoverableState) -> dict[str, object]:
    """Pause on a durable LangGraph interrupt; replay before this point is harmless."""

    approval = interrupt(state["proposal"])
    return {
        "approval_decision": str(approval["decision"]),
        "decision_request_id": str(approval["decision_request_id"]),
        "approval_reason": approval.get("reason"),
    }


def finish_approval(state: RecoverableState) -> dict[str, object]:
    approved = state["approval_decision"] == ApprovalDecision.APPROVE.value
    return {
        "result": {
            "outcome": "APPROVED" if approved else "REJECTED",
            "action_kind": "CONTACT_JOB" if approved else None,
            "action_status": "QUEUED" if approved else None,
        }
    }


def route_after_policy(state: RecoverableState) -> Literal["build_contact_proposal", "end"]:
    return "build_contact_proposal" if state.get("decision") == Decision.MATCH.value else "end"


def build_recoverable_graph(
    checkpointer, *, interrupt_after: list[str] | None = None
):
    """Compile the recoverable graph once; every graph node remains side-effect free."""

    builder = StateGraph(RecoverableState)
    builder.add_node("normalize_job", normalize_job)
    builder.add_node("apply_keyword_policy", apply_keyword_policy)
    builder.add_node("build_contact_proposal", build_contact_proposal)
    builder.add_node("request_approval", request_approval)
    builder.add_node("finish_approval", finish_approval)
    builder.add_edge(START, "normalize_job")
    builder.add_edge("normalize_job", "apply_keyword_policy")
    builder.add_conditional_edges(
        "apply_keyword_policy",
        route_after_policy,
        {"build_contact_proposal": "build_contact_proposal", "end": END},
    )
    builder.add_edge("build_contact_proposal", "request_approval")
    builder.add_edge("request_approval", "finish_approval")
    builder.add_edge("finish_approval", END)
    return builder.compile(
        checkpointer=checkpointer,
        interrupt_after=interrupt_after,
    )
