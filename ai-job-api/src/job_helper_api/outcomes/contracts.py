from typing import Literal, Self

from pydantic import Field, StrictBool, model_validator

from ..contracts import Input

Outcome = Literal["WAITING", "NO_REPLY", "REPLIED", "POSITIVE", "REJECTED", "UNKNOWN"]
ReadState = Literal["READ", "UNREAD", "UNKNOWN"]
Source = Literal[
    "APPLICATION_FLOW",
    "BOSS_PASSIVE_MESSAGE",
    "BOSS_SEND_ACK",
    "BOSS_CONVERSATION_SNAPSHOT",
    "BOSS_EXACT_MESSAGE_STATUS",
]


class Message(Input):
    messageId: str = Field(min_length=1, max_length=160)
    clientMessageId: str | None = Field(default=None, min_length=1, max_length=160)
    role: Literal["HR", "USER"]
    text: str = Field(max_length=4000)
    sentAt: int | None = Field(default=None, gt=0)
    deliveryState: Literal["ACKNOWLEDGED", "UNKNOWN"] = "UNKNOWN"


class ReadEvidence(Input):
    messageId: str = Field(min_length=1, max_length=160)
    state: Literal["READ", "UNREAD"]
    source: Literal["BOSS_EXACT_MESSAGE_STATUS"]
    observedAt: int = Field(gt=0)


class Coverage(Input):
    anchorMessageId: str = Field(min_length=1, max_length=160)
    latestMessageId: str = Field(min_length=1, max_length=160)
    checkedAt: int = Field(gt=0)
    completeAfterAnchor: StrictBool

    @model_validator(mode="after")
    def complete(self) -> Self:
        if not self.completeAfterAnchor:
            raise ValueError("Incomplete coverage must be omitted")
        return self


class Observation(Input):
    eventId: str = Field(min_length=1, max_length=128)
    encryptJobId: str = Field(min_length=1, max_length=255)
    conversationKey: str | None = Field(default=None, min_length=1, max_length=255)
    bossId: str | None = Field(default=None, min_length=1, max_length=80)
    source: Source
    observedAt: int = Field(gt=0)
    bindingObservedAt: int = Field(gt=0)
    messages: list[Message] = Field(default_factory=list, max_length=40)
    readEvidence: ReadEvidence | None = None
    coverage: Coverage | None = None

    @model_validator(mode="after")
    def coherent(self) -> Self:
        if self.source == "APPLICATION_FLOW":
            if self.messages or self.readEvidence or self.coverage:
                raise ValueError("Application intent cannot assert message evidence")
        elif not self.conversationKey or not self.bossId:
            raise ValueError("Message evidence requires verified conversation/peer binding")
        elif not (self.messages or self.readEvidence or self.coverage):
            raise ValueError("An observation requires actual message or status evidence")
        if self.coverage and self.source != "BOSS_CONVERSATION_SNAPSHOT":
            raise ValueError("Only a verified latest conversation snapshot proves coverage")
        for message in self.messages:
            if message.deliveryState == "ACKNOWLEDGED":
                if message.role != "USER" or self.source not in {
                    "BOSS_SEND_ACK",
                    "BOSS_CONVERSATION_SNAPSHOT",
                }:
                    raise ValueError("Only an actual outgoing receipt proves send")
                if self.source == "BOSS_SEND_ACK" and (
                    not message.clientMessageId
                    or message.messageId == message.clientMessageId
                    or message.messageId.startswith("client:")
                ):
                    raise ValueError("ACK requires correlated distinct client and server IDs")
        if self.source == "BOSS_SEND_ACK" and (
            not self.messages
            or any(m.role != "USER" or m.deliveryState != "ACKNOWLEDGED" for m in self.messages)
        ):
            raise ValueError("ACK observations contain only correlated outgoing receipts")
        return self


class ObservationBatch(Input):
    schemaVersion: Literal[1]
    observations: list[Observation] = Field(min_length=1, max_length=32)


class Feedback(Input):
    requestId: str = Field(min_length=1, max_length=128)
    action: Literal["CONFIRM", "CORRECT", "IGNORE"]
    correctedOutcome: Outcome | None = None
    correctedReason: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def correction(self) -> Self:
        if self.action == "CORRECT" and not self.correctedReason:
            raise ValueError("Correction requires a reason")
        if self.action != "CORRECT" and (self.correctedOutcome or self.correctedReason):
            raise ValueError("Only corrections accept correction fields")
        return self


class Claim(Input):
    workerId: str = Field(min_length=1, max_length=80)


class Lease(Input):
    leaseToken: str = Field(min_length=1, max_length=128)
    revision: int = Field(gt=0)
    inputHash: str = Field(pattern=r"^[a-f0-9]{64}$")


class Analyze(Lease):
    analysisKind: Literal["FACTS_ONLY", "REJECTION_CAUSES"]


class Artifact(Lease):
    artifactId: str = Field(min_length=1, max_length=36)


class Park(Artifact):
    interruptId: str = Field(min_length=1, max_length=128)


class Complete(Artifact):
    feedbackId: str = Field(min_length=1, max_length=36)


class Retry(Lease):
    errorCode: Literal["DEPENDENCY_UNAVAILABLE", "CHECKPOINT_UNAVAILABLE", "INTERNAL_FAILURE"]
