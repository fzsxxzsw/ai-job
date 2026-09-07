from datetime import date, datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .contracts import Input

Task = Literal["filter", "greeting", "conversation", "analysis"]


class RouteModel(Input):
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
    enabled: bool = False
    tasks: list[Task] = Field(default_factory=list, max_length=4)
    priority: int = Field(default=50, ge=1, le=100)
    thinking: Literal["auto", "off", "on"] = "auto"
    freeOnlyConfirmed: bool = False


class RoutingInput(Input):
    enabled: bool = False
    revision: int = Field(default=0, ge=0)
    strategy: Literal["balanced", "expiry_first"] = "balanced"
    maxAttempts: int = Field(default=3, ge=1, le=5)
    totalTimeoutSeconds: int = Field(default=40, ge=5, le=120)
    models: list[RouteModel] = Field(default_factory=list, max_length=300)

    @model_validator(mode="after")
    def unique_models(self):
        if len({m.id for m in self.models}) != len(self.models):
            raise ValueError("模型不能重复")
        return self


class QuotaSnapshot(Input):
    id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
    remainingTokens: int = Field(ge=0, le=10_000_000_000)
    expiresOn: date
    observedAt: datetime
    freeOnlyConfirmed: bool = False

    @field_validator("observedAt")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("额度快照时间必须包含时区")
        return value


class QuotaImport(Input):
    snapshots: list[QuotaSnapshot] = Field(min_length=1, max_length=300)

    @model_validator(mode="after")
    def unique_models(self):
        if len({m.id for m in self.snapshots}) != len(self.snapshots):
            raise ValueError("额度条目不能重复")
        return self


class RouteTest(Input):
    id: str = Field(min_length=1, max_length=128)
