from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


Keyword = Annotated[str, StringConstraints(max_length=100)]


class Decision(StrEnum):
    REJECT = "REJECT"
    REVIEW = "REVIEW"
    MATCH = "MATCH"


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
