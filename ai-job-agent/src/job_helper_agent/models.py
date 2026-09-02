from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


Keyword = Annotated[str, StringConstraints(max_length=100)]


class Decision(StrEnum):
    REJECT = "REJECT"
    REVIEW = "REVIEW"
    MATCH = "MATCH"


class RunStatus(StrEnum):
    CREATED = "CREATED"
    RUNNING = "RUNNING"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ApprovalDecision(StrEnum):
    APPROVE = "APPROVE"
    REJECT = "REJECT"


class JobDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=300)
    description: str = Field(default="", max_length=20_000)
    excluded_keywords: list[Keyword] = Field(default_factory=list, max_length=50)
    required_keywords: list[Keyword] = Field(default_factory=list, max_length=50)


class DecisionEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rule: str
    keyword: str | None = None


class JobDecisionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Decision
    reasons: list[str]
    evidence: list[DecisionEvidence]
    policy_version: str


SourceJobRef = Annotated[
    str,
    StringConstraints(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$",
    ),
]


class RunCreateRequest(JobDecisionRequest):
    request_id: UUID
    source_job_ref: SourceJobRef


class ActionProposal(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    proposal_id: UUID
    action_kind: str = Field(pattern=r"^CONTACT_JOB$")
    target_ref: SourceJobRef
    preview: str = Field(max_length=500)
    preview_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ResumeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposal_id: UUID
    interrupt_id: str = Field(min_length=1, max_length=128)
    preview_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    decision_request_id: UUID
    decision: ApprovalDecision
    reason: str | None = Field(default=None, max_length=1000)


class RunResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    request_id: UUID
    status: RunStatus
    decision: Decision | None = None
    proposal: ActionProposal | None = None
    interrupt_id: str | None = None
    result: dict[str, object] | None = None
    policy_version: str
    graph_version: str


class RunEventResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID
    seq: int
    event_type: str
    payload: dict[str, object]
    occurred_at: str


class RunHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: UUID
    events: list[RunEventResponse]
