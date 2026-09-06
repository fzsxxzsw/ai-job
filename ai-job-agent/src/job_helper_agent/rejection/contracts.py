from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

MAX_BODY_BYTES = 256_000
MAX_ID = 9_007_199_254_740_991


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class SnapshotInput(Input):
    encryptJobId: str = Field(min_length=1, max_length=255)
    appliedAt: int = Field(gt=0, le=MAX_ID)
    jobBaseInfo: str = Field(max_length=30_000)
    jobExtInfo: str = Field(max_length=60_000)
    preMatchResult: Any = None


class MessageInput(Input):
    messageId: str | None = Field(default=None, max_length=160)
    role: Literal['HR', 'USER']
    text: str = Field(min_length=1, max_length=4000)
    timestamp: int | None = Field(default=None, gt=0, le=MAX_ID)


class AnalysisInput(Input):
    encryptJobId: str = Field(min_length=1, max_length=255)
    conversationKey: str = Field(min_length=1, max_length=255)
    completeness: Literal['POSSIBLY_INCOMPLETE', 'COMPLETE'] = 'POSSIBLY_INCOMPLETE'
    messages: list[MessageInput] = Field(min_length=1, max_length=12)


class FeedbackInput(Input):
    action: Literal['CONFIRM', 'CORRECT', 'IGNORE']
    correctedReason: str | None = Field(default=None, max_length=1000)
    correctedCode: str | None = Field(default=None, max_length=80)


class RejectionError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code, self.message = code, message
