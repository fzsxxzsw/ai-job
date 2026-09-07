from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field, model_validator

from ..automation.contracts import Digest, Id, RequestId
from ..contracts import Input
from ..database import dumps

Window = Literal[7, 14, 30]
EventType = Literal[
    "CONTACT_INITIATED",
    "RESUME_SENT",
    "HR_REPLIED",
    "INTERVIEW_INVITED",
    "INTERVIEW_COMPLETED",
    "REJECTED",
    "OFFER_RECEIVED",
    "WITHDRAWN",
    "CORRECTION",
]


class Fact(Input):
    factId: Id
    text: str = Field(min_length=1, max_length=4000)
    verificationStatus: Literal["USER_CONFIRMED", "SOURCE_PRESENT"]


class VersionInput(RequestId):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    content: str = Field(min_length=1, max_length=60000)
    parentVersionId: Id | None = None
    source: Literal["USER_TEXT", "LEGACY_IMPORT"] = "USER_TEXT"
    facts: list[Fact] = Field(default_factory=list, max_length=500)

    @model_validator(mode="after")
    def grounded(self):
        if not self.content.strip():
            raise ValueError("Resume content must contain text")
        if len({fact.factId for fact in self.facts}) != len(self.facts) or any(
            fact.text not in self.content for fact in self.facts
        ):
            raise ValueError("Facts must be unique references to supplied resume text")
        return self


class SelectVersion(RequestId):
    baseActiveVersionId: Id | None


class Evidence(Input):
    source: Literal["USER_CONFIRMATION", "USER_NOTE"]
    referenceId: Id | None = None
    quote: str = Field(min_length=1, max_length=4000)
    resumeVersionId: Id | None = None
    contentHash: Digest | None = None


class EventInput(RequestId):
    eventType: EventType
    occurredAt: int = Field(gt=0)
    evidence: Evidence
    confirmation: Literal["USER_CONFIRMED", "INFERRED"]
    supersedesEventId: Id | None = None


class ReviewInput(RequestId):
    windowDays: Window = 14
    cutoff: int = Field(gt=0)
    resumeVersionId: Id | None = None
    objective: str | None = Field(default=None, max_length=2000)
    budget: int | None = Field(default=None, ge=0, le=10000)
    hardConstraints: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded(self):
        if len(dumps(self.hardConstraints).encode()) > 60000:
            raise ValueError("Constraints too large")
        return self


class Preview(Input):
    selectedPatchIds: list[Id] = Field(min_length=1, max_length=100)


class Accept(Preview, RequestId):
    baseVersionId: Id
    previewHash: Digest


class ApproveStrategy(RequestId):
    previewHash: Digest
    basePreferenceHash: Digest


class ConfirmReview(RequestId):
    revision: int = Field(ge=1)
    inputHash: Digest
    decision: Literal["CONFIRM", "IGNORE"]


class CleanupLease(Input):
    jobId: Id
    leaseToken: Annotated[str, Field(min_length=20, max_length=128)]


class CleanupComplete(CleanupLease):
    checkpointDeleted: Literal[True]
