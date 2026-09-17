from typing import Annotated, Any, Literal

from pydantic import Field, StrictBool, model_validator

from ..contracts import FilterInput, Input

Id = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:@-]+$")]
Subject = Annotated[str, Field(min_length=1, max_length=255)]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
ActionKind = Literal[
    "CONTACT_JOB",
    "SEND_GREETING",
    "SEND_TEXT",
    "SEND_RESUME",
    "ACCEPT_PHONE",
    "ACCEPT_WECHAT",
    "ACCEPT_RESUME",
]
WaitFor = Literal["EXECUTION", "CONFIRMATION", "NONE"]
ErrorCode = Literal[
    "WORKER_UNAVAILABLE",
    "NETWORK_ERROR",
    "MODEL_UNAVAILABLE",
    "MODEL_TIMEOUT",
    "ANALYSIS_BUSY",
    "VALIDATION_FAILED",
    "CHECKPOINT_UNAVAILABLE",
    "WORKER_DEADLINE",
    "INTERNAL_ERROR",
]


class RequestId(Input):
    requestId: Id


class UncertainReview(RequestId):
    reviewed: StrictBool


class Exchange(Input):
    kind: Literal["ACCEPT_PHONE", "ACCEPT_WECHAT", "ACCEPT_RESUME"]
    requestMessageId: Id


class ReplyInput(Input):
    inboundMessageId: Id
    inboundSentAt: int | None = Field(default=None, gt=0)
    question: str = Field(min_length=1, max_length=5000)
    jobKey: str = Field(min_length=1, max_length=64)
    jobInfo: dict[str, Any] | None = None
    exchangeRequest: Exchange | None = None
    platformResumeId: Id | None = None

    @model_validator(mode="after")
    def request_binding(self):
        if self.exchangeRequest and self.exchangeRequest.requestMessageId != self.inboundMessageId:
            raise ValueError("Exchange must bind the exact inbound request")
        return self


class ManualTakeoverInput(RequestId):
    platformAccount: Subject
    conversationKey: Subject
    encryptJobId: Subject
    bossId: Subject
    jobKey: str = Field(min_length=1, max_length=64)
    throughInboundMessageId: Id
    throughInboundSentAt: int | None = Field(default=None, gt=0)
    throughInboundText: str = Field(min_length=1, max_length=5000)
    manualOutboundClientMid: Id
    manualOutboundMessageId: Id
    manualOutboundSentAt: int = Field(gt=0)
    manualText: str = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def coherent(self):
        if self.jobKey != self.encryptJobId + ":" + self.platformAccount:
            raise ValueError("Manual takeover jobKey does not match the authenticated job/account")
        if (
            not self.manualOutboundClientMid.isdigit()
            or int(self.manualOutboundClientMid) <= 0
            or not self.manualOutboundMessageId.isdigit()
            or int(self.manualOutboundMessageId) <= 0
            or self.manualOutboundMessageId == self.manualOutboundClientMid
        ):
            raise ValueError("Manual takeover requires distinct positive client and server MIDs")
        return self


class ManualTakeoverStatusInput(Input):
    platformAccount: Subject
    conversationKey: Subject
    encryptJobId: Subject
    bossId: Subject
    jobKey: str = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def coherent(self):
        if self.jobKey != self.encryptJobId + ":" + self.platformAccount:
            raise ValueError("Manual takeover jobKey does not match the authenticated job/account")
        return self


class LocalAssessment(Input):
    passed: StrictBool
    reason: str = Field(max_length=2000)


class Greeting(Input):
    enabled: StrictBool
    text: str = Field(max_length=5000)


class ApplicationInput(Input):
    cycleKey: Id
    filterInput: FilterInput
    localAssessment: LocalAssessment
    greeting: Greeting
    preparedResumeVersionId: Id | None = None
    strategyPlanId: Id | None = None


class FollowUpInput(Input):
    applicationId: Id
    anchorOutboundMessageId: Id
    anchorOutboundAt: int = Field(gt=0)
    evidenceTrack: Literal["EXACT_READ_NO_REPLY", "EXACT_UNREAD_NO_REPLY", "ACKNOWLEDGED_WAITING"]
    jobKey: str = Field(min_length=1, max_length=64)
    jobInfo: dict[str, Any]
    campaignId: Id | None = None
    campaignStep: Literal[1, 2] | None = None
    fixedText: str | None = Field(default=None, min_length=1, max_length=500)

    @model_validator(mode="after")
    def campaign_binding(self):
        supplied = (self.campaignId is not None, self.campaignStep is not None, self.fixedText is not None)
        if any(supplied) and not all(supplied):
            raise ValueError("Campaign id, step and fixed text must be supplied together")
        if self.fixedText is not None and not self.fixedText.strip():
            raise ValueError("Campaign text must contain text")
        return self


class JobInput(RequestId):
    kind: Literal["REPLY", "APPLICATION", "FOLLOW_UP"]
    platformAccount: Subject
    conversationKey: Subject | None
    encryptJobId: Subject
    bossId: Subject | None
    input: ReplyInput | ApplicationInput | FollowUpInput

    @model_validator(mode="after")
    def coherent(self):
        if self.kind == "REPLY":
            if (
                not isinstance(self.input, ReplyInput)
                or not self.bossId
                or not self.conversationKey
            ):
                raise ValueError("Reply requires exact binding")
            if self.input.jobKey != self.encryptJobId + ":" + self.platformAccount:
                raise ValueError("Legacy jobKey does not match the authenticated job/account")
        elif self.kind == "FOLLOW_UP":
            if (
                not isinstance(self.input, FollowUpInput)
                or not self.bossId
                or not self.conversationKey
            ):
                raise ValueError("Follow-up requires exact binding")
            if self.input.jobKey != self.encryptJobId + ":" + self.platformAccount:
                raise ValueError("Follow-up jobKey does not match the authenticated job/account")
        elif not isinstance(self.input, ApplicationInput):
            raise ValueError("Application input required")
        return self


class Executor(Input):
    executorId: Id
    platformAccount: Subject


class ExecutorHeartbeat(Executor):
    capabilities: list[ActionKind] = Field(min_length=1, max_length=7)
    replyEnabled: StrictBool
    deliveryEnabled: StrictBool


class ActionClaim(Executor):
    jobId: Id


class Dispatch(Executor):
    leaseToken: str = Field(min_length=20, max_length=128)
    authorizationRevision: int = Field(ge=1)
    clientMid: Id | None


class Binding(Input):
    bossId: Subject
    conversationKey: Subject


class ResolveBinding(Binding, RequestId):
    platformAccount: Subject


class Receipt(Executor, RequestId):
    dispatchToken: str = Field(min_length=20, max_length=128)
    clientMid: Id | None
    status: Literal["ACKNOWLEDGED", "FAILED", "UNKNOWN"]
    serverMid: Id | None = None
    platformCode: int | None = None
    occurredAt: int = Field(gt=0)
    errorCode: (
        Literal[
            "NETWORK_ERROR",
            "PLATFORM_REJECTED",
            "RECEIPT_MISSING",
            "CONTEXT_LOST",
            "PLATFORM_RISK",
            "ATTACHMENT_CHANGED",
            "AUTHORIZATION_CHANGED",
            "PLATFORM_RESULT_UNKNOWN",
            "DISPATCH_INTERRUPTED",
        ]
        | None
    ) = None
    resolvedBinding: Binding | None = None
    executionPhase: Literal["BEFORE_PLATFORM_CALL", "PLATFORM_RESULT"] = "PLATFORM_RESULT"


class Approval(RequestId):
    decision: Literal["APPROVE", "DECLINE"]
    payloadHash: Digest


class Worker(Input):
    workerId: Id


class Heartbeat(Worker):
    graphVersion: str = Field(min_length=1, max_length=80)
    lastErrorCode: ErrorCode | None = None


class Lease(Input):
    leaseToken: str = Field(min_length=20, max_length=128)
    revision: int = Field(ge=1)
    inputHash: Digest


class Artifact(Lease):
    artifactId: Id


class Park(Artifact):
    interruptId: Id
    waitFor: WaitFor


class Retry(Lease):
    errorCode: ErrorCode
