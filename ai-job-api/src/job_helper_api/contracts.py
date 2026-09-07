import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PreferenceInput(Input):
    preference: dict[str, Any] | None = None
    email: str | None = Field(default=None, max_length=56)
    phone: str | None = Field(default=None, max_length=11)
    aiSeatStatus: bool | Literal[0, 1] | None = None

    @field_validator("email")
    @classmethod
    def email_address(cls, value: str | None) -> str | None:
        if value and not re.fullmatch(r"[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+", value):
            raise ValueError("请输入单个有效邮箱")
        return value


class FilterInput(Input):
    prompt: str = Field(default="", max_length=10000)
    jobBaseInfo: str = Field(default="{}", max_length=30000)
    jobExtInfo: str = Field(default="{}", max_length=60000)
    resumeMatchEnabled: bool = False
    minMatchScore: int = Field(default=0, ge=0, le=100)
    titleRuleStatus: str | None = Field(default=None, max_length=32)
    titleMatchedKeywords: list[str] = Field(default_factory=list, max_length=100)


class FilterOutput(Input):
    filter: StrictBool
    reason: str = Field(min_length=1, max_length=2000)
    decisionStatus: Literal["MATCH", "REJECT", "UNKNOWN"] | None = None
    score: int | None = Field(default=None, ge=0, le=100)
    matchedStrengths: list[str] | None = None
    gaps: list[str] | None = None
    engine: str | None = None
    titleScore: int | None = Field(default=None, ge=0, le=100)
    skillScore: int | None = Field(default=None, ge=0, le=100)
    confidence: Literal["HIGH", "MEDIUM", "LOW"] | None = None
    evidenceCount: int | None = Field(default=None, ge=0)


class AskInput(Input):
    question: str = Field(min_length=1, max_length=5000)
    jobKey: str = Field(min_length=1, max_length=64)
    jobInfo: dict[str, Any] | None = None


class DebugInput(AskInput):
    userPrompt: str | None = Field(default=None, max_length=5000)
    messageList: list[dict[str, Any]] = Field(default_factory=list, max_length=40)

    @field_validator("messageList")
    @classmethod
    def bounded_history(cls, values: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for item in values:
            if item.get("role") not in {"user", "assistant", "model"}:
                raise ValueError("调试历史只能包含用户与助手消息")
            if not isinstance(item.get("content"), str) or len(item["content"]) > 5000:
                raise ValueError("调试消息内容或长度不正确")
        return values


class ConfigInput(Input):
    # Identity and testPassed are never trusted as authentication or test proof.
    id: int | None = None
    userId: int | None = None
    provider: int | None = Field(default=None, ge=0, le=6)
    modelName: str | None = Field(default=None, max_length=128)
    apiKey: str | None = Field(default=None, max_length=255)
    baseUrl: str | None = Field(default=None, max_length=1024)
    completionsPath: str | None = Field(default=None, max_length=255)
    timeout: int | None = Field(default=None, ge=3, le=120)
    testPassed: int | None = None
    status: Literal[0, 1] | None = None
    userPrompt: str | None = Field(default=None, max_length=5000)
    apiKeyConfigured: bool | None = None


class AuditInput(Input):
    auditId: str = Field(min_length=1, max_length=240)
    deliveryKey: str = Field(min_length=1, max_length=240)
    kind: Literal["greeting", "ai-reply"]
    status: Literal["queued", "sending", "acknowledged", "receipt", "failed", "blocked"]
    jobTitle: str = Field(default="", max_length=300)
    contentHash: str = Field(min_length=1, max_length=120)
    contentLength: int = Field(ge=0, le=100000)
    attempts: int = Field(default=0, ge=0, le=100000)
    createdAt: int = Field(gt=0)
    updatedAt: int = Field(gt=0)
    bossId: str | None = Field(default=None, max_length=80)
    conversationKey: str | None = Field(default=None, max_length=240)
    clientMid: str | None = Field(default=None, max_length=80)
    serverMid: str | None = Field(default=None, max_length=80)


class SnapshotInput(Input):
    encryptJobId: str = Field(min_length=1, max_length=255)
    appliedAt: int = Field(gt=0)
    jobBaseInfo: str = Field(max_length=30000)
    jobExtInfo: str = Field(max_length=60000)
    preMatchResult: Any = None


class RejectionMessage(Input):
    messageId: str | None = Field(default=None, max_length=160)
    role: Literal["HR", "USER"]
    text: str = Field(min_length=1, max_length=4000)
    timestamp: int | None = None


class RejectionInput(Input):
    encryptJobId: str = Field(min_length=1, max_length=255)
    conversationKey: str = Field(min_length=1, max_length=255)
    completeness: Literal["POSSIBLY_INCOMPLETE", "COMPLETE"] = "POSSIBLY_INCOMPLETE"
    messages: list[RejectionMessage] = Field(min_length=1, max_length=12)


class FeedbackInput(Input):
    action: Literal["CONFIRM", "CORRECT", "IGNORE"]
    correctedReason: str | None = Field(default=None, max_length=1000)
    correctedCode: str | None = Field(default=None, max_length=80)
