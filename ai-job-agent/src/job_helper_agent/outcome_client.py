"""Fixed internal protocol. No browser payload supplies a destination or identity."""

import asyncio
import json
from typing import Annotated, Literal
from urllib.parse import quote, urlsplit

import httpx
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    ValidationError,
    model_validator,
)

OpaqueId = Annotated[str, Field(min_length=1, max_length=160)]
InputHash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
AnalysisKind = Literal["FACTS_ONLY", "REJECTION_CAUSES"]


class ProtocolModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)


class OutcomeProjection(ProtocolModel):
    schemaVersion: Literal[1]
    caseId: OpaqueId
    revision: Annotated[int, Field(ge=1)]
    inputHash: InputHash
    outcome: Literal[
        "WAITING", "NO_REPLY", "REPLIED", "POSITIVE", "REJECTED", "UNKNOWN"
    ]
    readState: Literal["READ", "UNREAD", "UNKNOWN"]
    waitingOn: Literal["HR", "USER", "NONE", "UNKNOWN"]
    processingStatus: Literal[
        "QUEUED", "PROCESSING", "READY", "WAITING_OBSERVATION", "RETRY", "FAILED"
    ]
    asOf: Annotated[int, Field(ge=1)]
    analysisKind: AnalysisKind
    policyVersion: OpaqueId
    graphVersion: Literal["outcome-graph-v1"]


class HumanFeedback(ProtocolModel):
    feedbackId: OpaqueId
    reportId: OpaqueId
    action: Literal["CONFIRM", "CORRECT", "IGNORE"]


class OutcomeClaim(ProtocolModel):
    jobId: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")]
    caseId: OpaqueId
    revision: Annotated[int, Field(ge=1)]
    inputHash: InputHash
    leaseToken: SecretStr
    leaseUntil: Annotated[int, Field(ge=1)]
    context: OutcomeProjection
    artifactId: OpaqueId | None
    reportId: OpaqueId | None
    executionMode: Literal["START", "RESUME_CONFIRMATION"]
    phase: Literal[
        "COLLECTING",
        "ANALYZING",
        "VALIDATING",
        "SAVING",
        "SAVED",
        "WAITING_CONFIRMATION",
        "COMPLETED",
        "FAILED",
        "RETRY",
    ]
    humanFeedback: HumanFeedback | None

    @model_validator(mode="after")
    def matching_projection(self) -> "OutcomeClaim":
        if (
            self.context.caseId != self.caseId
            or self.context.revision != self.revision
            or self.context.inputHash != self.inputHash
            or not self.leaseToken.get_secret_value()
        ):
            raise ValueError("inconsistent claim projection")
        if (self.context.analysisKind == "REJECTION_CAUSES") != (
            self.context.outcome == "REJECTED"
        ):
            raise ValueError("inconsistent analysis kind")
        if self.executionMode == "RESUME_CONFIRMATION":
            if (
                self.humanFeedback is None
                or not self.artifactId
                or not self.reportId
                or self.humanFeedback.reportId != self.reportId
            ):
                raise ValueError(
                    "confirmation requires durable report and feedback references"
                )
        elif self.humanFeedback is not None:
            raise ValueError("feedback requires confirmation execution mode")
        return self

    def lease_payload(self) -> dict[str, object]:
        return {
            "leaseToken": self.leaseToken.get_secret_value(),
            "revision": self.revision,
            "inputHash": self.inputHash,
        }


class Artifact(ProtocolModel):
    jobId: OpaqueId
    revision: Annotated[int, Field(ge=1)]
    inputHash: InputHash
    artifactId: OpaqueId
    reused: bool


class ReportReference(ProtocolModel):
    jobId: OpaqueId
    caseId: OpaqueId
    caseRevision: Annotated[int, Field(ge=1)]
    reportId: OpaqueId
    isCurrent: bool


class Publication(ReportReference):
    status: Literal["RUNNING"]
    phase: Literal["SAVED"]


class Completion(ReportReference):
    status: Literal["COMPLETED"]


class ValidArtifact(ProtocolModel):
    jobId: OpaqueId
    artifactId: OpaqueId
    valid: Literal[True]
    validationVersion: Literal["outcome-validation-v1"]


class InvalidArtifact(ProtocolModel):
    jobId: OpaqueId
    artifactId: OpaqueId
    valid: Literal[False]
    status: Literal["FAILED"]
    errorCode: Literal["INVALID_ARTIFACT"]


class ParkReceipt(ProtocolModel):
    jobId: OpaqueId
    reportId: OpaqueId
    status: Literal["WAITING_CONFIRMATION", "CONFIRMATION_READY"]
    phase: Literal["WAITING_CONFIRMATION"]


class Renewal(ProtocolModel):
    jobId: OpaqueId
    revision: Annotated[int, Field(ge=1)]
    leaseUntil: Annotated[int, Field(ge=1)]


class RetryReceipt(ProtocolModel):
    jobId: OpaqueId
    status: Literal["RETRY", "FAILED"]
    nextAttemptAt: Annotated[int, Field(ge=1)] | None


class OutcomeAPIError(Exception):
    """Only a fixed code is exposed; upstream bodies and credentials stay private."""

    def __init__(
        self,
        code: str,
        *,
        retryable: bool = False,
        superseded: bool = False,
        lease_lost: bool = False,
    ):
        super().__init__(code)
        self.code = code
        self.retryable = retryable
        self.superseded = superseded
        self.lease_lost = lease_lost


def validate_api_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("outcome API URL must be a service origin without credentials")
    # Configuration is server-owned. Never follow a redirect carrying the token.
    return value.rstrip("/")


class OutcomeAPIClient:
    MAX_RESPONSE_BYTES = 32_768

    def __init__(
        self,
        base_url: str,
        token: SecretStr,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._http = httpx.AsyncClient(
            base_url=validate_api_url(base_url),
            headers={"X-Internal-Token": token.get_secret_value()},
            timeout=httpx.Timeout(15, connect=5),
            limits=httpx.Limits(max_connections=3, max_keepalive_connections=3),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def _post(self, path: str, payload: dict, *, analyze: bool = False):
        try:
            async with (
                asyncio.timeout(150 if analyze else 15),
                self._http.stream(
                    "POST",
                    path,
                    json=payload,
                    timeout=httpx.Timeout(150 if analyze else 15, connect=5),
                ) as response,
            ):
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > self.MAX_RESPONSE_BYTES:
                        raise OutcomeAPIError("INVALID_RESPONSE")
                try:
                    envelope = json.loads(data)
                except (ValueError, UnicodeError):
                    raise OutcomeAPIError("INVALID_RESPONSE") from None
                if not isinstance(envelope, dict):
                    raise OutcomeAPIError("INVALID_RESPONSE")
                if response.status_code == 409:
                    conflict = envelope.get("message")
                    if conflict == "ANALYSIS_BUSY":
                        raise OutcomeAPIError("ANALYSIS_BUSY", retryable=True)
                    if conflict == "LEASE_LOST":
                        # The current attempt ends, but the same graph revision can
                        # be resumed with a newly claimed lease after expiry.
                        raise OutcomeAPIError("LEASE_LOST", lease_lost=True)
                    if conflict == "REVISION_SUPERSEDED":
                        raise OutcomeAPIError("REVISION_SUPERSEDED", superseded=True)
                    if conflict in ("INPUT_MISMATCH", "ARTIFACT_MISMATCH"):
                        raise OutcomeAPIError(conflict)
                    raise OutcomeAPIError("UNEXPECTED_CONFLICT")
                if response.status_code == 404:
                    raise OutcomeAPIError("JOB_NOT_FOUND")
                if response.status_code in {401, 403}:
                    raise OutcomeAPIError("AUTH_UNAVAILABLE")
                if response.status_code == 429 or response.status_code >= 500:
                    raise OutcomeAPIError("DEPENDENCY_UNAVAILABLE", retryable=True)
                if response.status_code != 200 or envelope.get("code") != 200:
                    raise OutcomeAPIError("INVALID_RESPONSE")
                if "data" not in envelope:
                    raise OutcomeAPIError("INVALID_RESPONSE")
                return envelope["data"]
        except (httpx.HTTPError, TimeoutError):
            raise OutcomeAPIError("DEPENDENCY_UNAVAILABLE", retryable=True) from None

    @staticmethod
    def _parse(model, data):
        try:
            return model.model_validate(data)
        except ValidationError:
            raise OutcomeAPIError("INVALID_RESPONSE") from None

    @staticmethod
    def _path(claim: OutcomeClaim, operation: str) -> str:
        return f"/internal/outcomes/jobs/{quote(claim.jobId, safe='')}/{operation}"

    async def claim(self, worker_id: str) -> OutcomeClaim | None:
        data = await self._post("/internal/outcomes/claim", {"workerId": worker_id})
        return None if data is None else self._parse(OutcomeClaim, data)

    async def renew(self, claim: OutcomeClaim) -> None:
        result = self._parse(
            Renewal, await self._post(self._path(claim, "renew"), claim.lease_payload())
        )
        if result.jobId != claim.jobId or result.revision != claim.revision:
            raise OutcomeAPIError("INVALID_RESPONSE")

    async def analyze(self, claim: OutcomeClaim) -> str:
        result = self._parse(
            Artifact,
            await self._post(
                self._path(claim, "analyze"),
                {**claim.lease_payload(), "analysisKind": claim.context.analysisKind},
                analyze=True,
            ),
        )
        if (result.jobId, result.revision, result.inputHash) != (
            claim.jobId,
            claim.revision,
            claim.inputHash,
        ):
            raise OutcomeAPIError("INVALID_RESPONSE")
        return result.artifactId

    async def commit(self, claim: OutcomeClaim, artifact_id: str) -> Publication:
        result = self._parse(
            Publication,
            await self._post(
                self._path(claim, "commit"),
                {**claim.lease_payload(), "artifactId": artifact_id},
            ),
        )
        if (result.jobId, result.caseId, result.caseRevision) != (
            claim.jobId,
            claim.caseId,
            claim.revision,
        ):
            raise OutcomeAPIError("INVALID_RESPONSE")
        return result

    async def validate(self, claim: OutcomeClaim, artifact_id: str) -> bool:
        data = await self._post(
            self._path(claim, "validate"),
            {**claim.lease_payload(), "artifactId": artifact_id},
        )
        model = (
            ValidArtifact
            if isinstance(data, dict) and data.get("valid") is True
            else InvalidArtifact
        )
        result = self._parse(model, data)
        if result.jobId != claim.jobId or result.artifactId != artifact_id:
            raise OutcomeAPIError("INVALID_RESPONSE")
        return result.valid

    async def park(
        self, claim: OutcomeClaim, artifact_id: str, report_id: str, interrupt_id: str
    ) -> None:
        result = self._parse(
            ParkReceipt,
            await self._post(
                self._path(claim, "park"),
                {
                    **claim.lease_payload(),
                    "artifactId": artifact_id,
                    "interruptId": interrupt_id,
                },
            ),
        )
        if result.jobId != claim.jobId or result.reportId != report_id:
            raise OutcomeAPIError("INVALID_RESPONSE")

    async def complete(self, claim: OutcomeClaim, artifact_id: str) -> Completion:
        if claim.humanFeedback is None:
            raise OutcomeAPIError("MISSING_HUMAN_FEEDBACK")
        result = self._parse(
            Completion,
            await self._post(
                self._path(claim, "complete"),
                {
                    **claim.lease_payload(),
                    "artifactId": artifact_id,
                    "feedbackId": claim.humanFeedback.feedbackId,
                },
            ),
        )
        if (result.jobId, result.caseId, result.caseRevision, result.reportId) != (
            claim.jobId,
            claim.caseId,
            claim.revision,
            claim.humanFeedback.reportId,
        ):
            raise OutcomeAPIError("INVALID_RESPONSE")
        return result

    async def retry(
        self,
        claim: OutcomeClaim,
        code: Literal[
            "DEPENDENCY_UNAVAILABLE", "CHECKPOINT_UNAVAILABLE", "INTERNAL_FAILURE"
        ],
    ) -> None:
        receipt = self._parse(
            RetryReceipt,
            await self._post(
                self._path(claim, "retry"), {**claim.lease_payload(), "errorCode": code}
            ),
        )
        if receipt.jobId != claim.jobId:
            raise OutcomeAPIError("INVALID_RESPONSE")
