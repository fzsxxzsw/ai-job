"""Fixed unified automation protocol; the API owns inputs and side effects."""

import asyncio
import json
from typing import Annotated, Literal
from urllib.parse import quote

import httpx
from pydantic import Field, SecretStr, ValidationError, model_validator

from job_helper_agent.outcome_client import (
    InputHash,
    OpaqueId,
    ProtocolModel,
    validate_api_url,
)

JobKind = Literal["REPLY", "APPLICATION", "CAREER_REVIEW"]
WaitFor = Literal["EXECUTION", "CONFIRMATION", "NONE"]


class Projection(ProtocolModel):
    schemaVersion: Literal[1]
    jobKind: JobKind
    requiresExecution: bool
    requiresConfirmation: bool


class Receipt(ProtocolModel):
    actionId: OpaqueId
    status: Literal["ACKNOWLEDGED", "FAILED", "UNKNOWN", "CANCELLED"]


class Approval(ProtocolModel):
    actionId: OpaqueId
    approvalId: OpaqueId
    decision: Literal["APPROVE", "DECLINE"]


class ResumeData(ProtocolModel):
    receipts: Annotated[list[Receipt], Field(max_length=20)]
    approvals: Annotated[list[Approval], Field(max_length=20)]


class AutomationClaim(ProtocolModel):
    jobId: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")]
    kind: JobKind
    revision: Annotated[int, Field(ge=1)]
    inputHash: InputHash
    leaseToken: SecretStr
    leaseUntil: Annotated[int, Field(ge=1)]
    executionMode: Literal[
        "START", "RESUME_EXECUTION", "RESUME_CONFIRMATION", "RECONCILE_TERMINAL"
    ]
    phase: OpaqueId
    artifactId: OpaqueId | None
    resultId: OpaqueId | None
    resumeData: ResumeData
    context: Projection

    @model_validator(mode="after")
    def consistent(self):
        if (
            self.context.jobKind != self.kind
            or not self.leaseToken.get_secret_value().strip()
        ):
            raise ValueError("invalid claim binding")
        if self.executionMode != "START" and not self.artifactId:
            raise ValueError("resume requires a durable artifact")
        if self.executionMode == "RECONCILE_TERMINAL" and (
            not self.resultId or self.phase != "FINALIZING"
        ):
            raise ValueError("terminal reconciliation requires a durable result")
        return self

    def lease_payload(self):
        return {
            "leaseToken": self.leaseToken.get_secret_value(),
            "revision": self.revision,
            "inputHash": self.inputHash,
        }


class Gathered(ProtocolModel):
    jobId: OpaqueId
    inputHash: InputHash
    ready: bool
    artifactId: OpaqueId | None


class Computed(ProtocolModel):
    jobId: OpaqueId
    artifactId: OpaqueId
    reused: bool


class Validated(ProtocolModel):
    jobId: OpaqueId
    artifactId: OpaqueId
    valid: bool
    errorCode: Literal["VALIDATION_FAILED"] | None

    @model_validator(mode="after")
    def consistent(self):
        if self.valid != (self.errorCode is None):
            raise ValueError("inconsistent validation")
        return self


class Committed(ProtocolModel):
    jobId: OpaqueId
    artifactId: OpaqueId
    status: Literal["RUNNING"]
    waitFor: WaitFor
    resultId: OpaqueId | None


class Completed(ProtocolModel):
    jobId: OpaqueId
    status: Literal["COMPLETED", "RUNNING", "UNCERTAIN", "FAILED"]
    resultId: OpaqueId | None
    waitFor: WaitFor

    @model_validator(mode="after")
    def consistent(self):
        if (self.status == "RUNNING") != (self.waitFor != "NONE"):
            raise ValueError("inconsistent completion")
        return self


class Parked(ProtocolModel):
    jobId: OpaqueId
    status: Literal[
        "WAITING_EXECUTION",
        "EXECUTION_READY",
        "WAITING_CONFIRMATION",
        "CONFIRMATION_READY",
        "UNCERTAIN",
    ]


class GraphCompleted(ProtocolModel):
    jobId: OpaqueId
    status: Literal["COMPLETED", "FAILED"]
    graphFinalized: Literal[True]


class CleanupClaim(ProtocolModel):
    jobId: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")]
    kind: Literal["CAREER_REVIEW"]
    cleanupId: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,160}$")]
    leaseToken: Annotated[SecretStr, Field(min_length=20, max_length=128)]
    leaseUntil: Annotated[int, Field(ge=1)]

    def lease_payload(self):
        return {"jobId": self.jobId, "leaseToken": self.leaseToken.get_secret_value()}


class CleanupRenewed(ProtocolModel):
    cleanupId: OpaqueId
    leaseUntil: Annotated[int, Field(ge=1)]


class CleanupCompleted(ProtocolModel):
    jobId: OpaqueId
    cleanupId: OpaqueId
    status: Literal["DELETED"]


class Renewed(ProtocolModel):
    jobId: OpaqueId
    leaseUntil: Annotated[int, Field(ge=1)]


class Retried(ProtocolModel):
    jobId: OpaqueId
    status: Literal["RETRY", "FAILED", "UNCERTAIN"]
    nextAttemptAt: Annotated[int, Field(ge=1)] | None


class AutomationAPIError(Exception):
    def __init__(self, code: str, *, retryable=False, lease_lost=False):
        super().__init__(code)
        self.code, self.retryable, self.lease_lost = code, retryable, lease_lost


class AutomationAPIClient:
    MAX_RESPONSE_BYTES = 32768

    def __init__(self, base_url: str, token: SecretStr, *, transport=None):
        self._http = httpx.AsyncClient(
            base_url=validate_api_url(base_url),
            headers={"X-Internal-Token": token.get_secret_value()},
            timeout=httpx.Timeout(15, connect=5),
            limits=httpx.Limits(max_connections=4, max_keepalive_connections=4),
            follow_redirects=False,
            trust_env=False,
            transport=transport,
        )

    async def close(self):
        await self._http.aclose()

    async def _post(self, path, payload, *, compute=False):
        try:
            async with asyncio.timeout(150 if compute else 15):
                async with self._http.stream(
                    "POST",
                    path,
                    json=payload,
                    timeout=httpx.Timeout(150 if compute else 15, connect=5),
                ) as response:
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > self.MAX_RESPONSE_BYTES:
                            raise AutomationAPIError("INVALID_RESPONSE")
                    try:
                        envelope = json.loads(raw)
                    except (ValueError, UnicodeError):
                        raise AutomationAPIError("INVALID_RESPONSE") from None
                    if not isinstance(envelope, dict):
                        raise AutomationAPIError("INVALID_RESPONSE")
                    if response.status_code in {401, 403}:
                        raise AutomationAPIError("INTERNAL_UNAUTHORIZED")
                    if response.status_code == 409:
                        code = envelope.get("message")
                        if code in {"LEASE_LOST", "JOB_NOT_RUNNABLE", "JOB_DELETED"}:
                            raise AutomationAPIError(code, lease_lost=True)
                        if code == "ANALYSIS_BUSY":
                            raise AutomationAPIError(code, retryable=True)
                        raise AutomationAPIError(
                            "INPUT_CHANGED"
                            if code == "INPUT_CHANGED"
                            else "INVALID_RESPONSE"
                        )
                    if response.status_code == 429 or response.status_code >= 500:
                        if envelope.get("message") in {
                            "MODEL_UNAVAILABLE",
                            "MODEL_TIMEOUT",
                        }:
                            raise AutomationAPIError(
                                envelope["message"], retryable=True
                            )
                        raise AutomationAPIError("WORKER_UNAVAILABLE", retryable=True)
                    if (
                        response.status_code != 200
                        or envelope.get("code") != 200
                        or "data" not in envelope
                    ):
                        raise AutomationAPIError("INVALID_RESPONSE")
                    return envelope["data"]
        except (httpx.HTTPError, TimeoutError):
            raise AutomationAPIError("NETWORK_ERROR", retryable=True) from None

    @staticmethod
    def _parse(model, data, claim=None, artifact=None):
        try:
            result = model.model_validate(data)
        except ValidationError:
            raise AutomationAPIError("INVALID_RESPONSE") from None
        if claim is not None and result.jobId != claim.jobId:
            raise AutomationAPIError("INVALID_RESPONSE")
        if artifact is not None and result.artifactId != artifact:
            raise AutomationAPIError("INVALID_RESPONSE")
        return result

    @staticmethod
    def _path(claim, operation):
        return f"/internal/automation/jobs/{quote(claim.jobId, safe='')}/{operation}"

    async def heartbeat(self, worker_id, graph_version, error_code):
        await self._post(
            "/internal/automation/heartbeat",
            {
                "workerId": worker_id,
                "graphVersion": graph_version,
                "lastErrorCode": error_code,
            },
        )

    async def claim(self, worker_id) -> AutomationClaim | None:
        data = await self._post("/internal/automation/claim", {"workerId": worker_id})
        return None if data is None else self._parse(AutomationClaim, data)

    async def renew(self, claim):
        return self._parse(
            Renewed,
            await self._post(self._path(claim, "renew"), claim.lease_payload()),
            claim,
        )

    async def gather(self, claim):
        result = self._parse(
            Gathered,
            await self._post(self._path(claim, "gather"), claim.lease_payload()),
            claim,
        )
        if result.inputHash != claim.inputHash:
            raise AutomationAPIError("INPUT_CHANGED")
        return result

    async def compute(self, claim):
        return self._parse(
            Computed,
            await self._post(
                self._path(claim, "compute"), claim.lease_payload(), compute=True
            ),
            claim,
        )

    async def validate(self, claim, artifact):
        return self._parse(
            Validated,
            await self._post(
                self._path(claim, "validate"),
                {**claim.lease_payload(), "artifactId": artifact},
            ),
            claim,
            artifact,
        )

    async def commit(self, claim, artifact):
        return self._parse(
            Committed,
            await self._post(
                self._path(claim, "commit"),
                {**claim.lease_payload(), "artifactId": artifact},
            ),
            claim,
            artifact,
        )

    async def park(self, claim, artifact, interrupt_id, wait_for):
        result = self._parse(
            Parked,
            await self._post(
                self._path(claim, "park"),
                {
                    **claim.lease_payload(),
                    "artifactId": artifact,
                    "interruptId": interrupt_id,
                    "waitFor": wait_for,
                },
            ),
            claim,
        )
        allowed = {"UNCERTAIN", f"WAITING_{wait_for}", f"{wait_for}_READY"}
        if result.status not in allowed:
            raise AutomationAPIError("INVALID_RESPONSE")
        return result

    async def complete(self, claim, artifact):
        return self._parse(
            Completed,
            await self._post(
                self._path(claim, "complete"),
                {**claim.lease_payload(), "artifactId": artifact},
            ),
            claim,
        )

    async def retry(self, claim, error_code):
        return self._parse(
            Retried,
            await self._post(
                self._path(claim, "retry"),
                {**claim.lease_payload(), "errorCode": error_code},
            ),
            claim,
        )

    async def graph_complete(self, claim, artifact):
        return self._parse(
            GraphCompleted,
            await self._post(
                self._path(claim, "graph-complete"),
                {**claim.lease_payload(), "artifactId": artifact},
            ),
            claim,
        )

    async def cleanup_claim(self, worker_id):
        data = await self._post(
            "/internal/automation/cleanup/claim", {"workerId": worker_id}
        )
        return None if data is None else self._parse(CleanupClaim, data)

    async def cleanup_renew(self, claim):
        result = self._parse(
            CleanupRenewed,
            await self._post(
                f"/internal/automation/cleanup/{quote(claim.cleanupId, safe='')}/renew",
                claim.lease_payload(),
            ),
        )
        if result.cleanupId != claim.cleanupId:
            raise AutomationAPIError("INVALID_RESPONSE")
        return result

    async def cleanup_complete(self, claim):
        result = self._parse(
            CleanupCompleted,
            await self._post(
                f"/internal/automation/cleanup/{quote(claim.cleanupId, safe='')}/complete",
                {**claim.lease_payload(), "checkpointDeleted": True},
            ),
            claim,
        )
        if result.cleanupId != claim.cleanupId:
            raise AutomationAPIError("INVALID_RESPONSE")
        return result
