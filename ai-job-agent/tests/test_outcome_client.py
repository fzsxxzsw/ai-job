import asyncio
import json

import httpx
import pytest
from job_helper_agent.config import AgentConfig, load_config
from job_helper_agent.outcome_client import (
    OutcomeAPIClient,
    OutcomeAPIError,
    OutcomeClaim,
)
from pydantic import SecretStr, ValidationError

TOKEN = "internal-test-secret-never-checkpoint-0000000000"
LEASE = "lease-test-secret-never-checkpoint-1111111111111"


def claim_data(**overrides):
    data = {
        "jobId": "job-1",
        "caseId": "case-1",
        "revision": 1,
        "inputHash": "a" * 64,
        "leaseToken": LEASE,
        "leaseUntil": 2_000_000_180_000,
        "context": {
            "schemaVersion": 1,
            "caseId": "case-1",
            "revision": 1,
            "inputHash": "a" * 64,
            "outcome": "POSITIVE",
            "readState": "UNKNOWN",
            "waitingOn": "USER",
            "processingStatus": "READY",
            "asOf": 2_000_000_000_000,
            "analysisKind": "FACTS_ONLY",
            "policyVersion": "outcome-policy-v1",
            "graphVersion": "outcome-graph-v1",
        },
        "artifactId": None,
        "reportId": None,
        "executionMode": "START",
        "phase": "COLLECTING",
        "humanFeedback": None,
    }
    data.update(overrides)
    return data


def envelope(data, *, code=200, message="ok"):
    return {
        "code": code,
        "message": message,
        "data": data,
        "extend": None,
        "requestId": "test",
    }


def test_worker_config_is_explicit_and_does_not_require_old_agent_database(monkeypatch):
    monkeypatch.setenv("AGENT_OUTCOMES_ENABLED", "true")
    monkeypatch.setenv("AGENT_OUTCOME_API_URL", "http://api:9100")
    monkeypatch.setenv("AGENT_OUTCOME_INTERNAL_TOKEN", TOKEN)
    config = load_config()
    assert config.outcomes_enabled
    assert config.outcome_api_url == "http://api:9100"
    assert not config.persistence_enabled
    assert AgentConfig(outcomes_enabled=True, internal_token=TOKEN).outcomes_enabled


@pytest.mark.parametrize("value", [None, "short", " " * 40])
def test_worker_requires_secret(value):
    with pytest.raises(ValidationError):
        AgentConfig(outcomes_enabled=True, outcome_internal_token=value)


@pytest.mark.parametrize(
    "url",
    [
        "file:///tmp/target",
        "http://user:password@api:9100",
        "http://api:9100/path",
        "http://api:9100?target=evil",
        "http://api:9100#fragment",
        "//api:9100",
    ],
)
def test_worker_rejects_non_origin_configuration(url):
    with pytest.raises(ValidationError):
        AgentConfig(outcomes_enabled=True, internal_token=TOKEN, outcome_api_url=url)


def test_claim_only_uses_internal_auth_and_runtime_lease_is_masked():
    async def scenario():
        def handle(request):
            assert request.url == "http://api:9100/internal/outcomes/claim"
            assert request.headers["X-Internal-Token"] == TOKEN
            assert "authorization" not in request.headers
            assert json.loads(request.content) == {"workerId": "test-worker"}
            return httpx.Response(200, json=envelope(claim_data()))

        client = OutcomeAPIClient(
            "http://api:9100", SecretStr(TOKEN), transport=httpx.MockTransport(handle)
        )
        try:
            claim = await client.claim("test-worker")
            assert claim.jobId == "job-1"
            assert LEASE not in repr(claim)
            assert TOKEN not in repr(client)
        finally:
            await client.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "status,message,code,superseded,lease_lost,retryable",
    [
        (401, TOKEN, "AUTH_UNAVAILABLE", False, False, False),
        (403, TOKEN, "AUTH_UNAVAILABLE", False, False, False),
        (409, "ANALYSIS_BUSY", "ANALYSIS_BUSY", False, False, True),
        (409, "REVISION_SUPERSEDED", "REVISION_SUPERSEDED", True, False, False),
        (409, "LEASE_LOST", "LEASE_LOST", False, True, False),
        (409, "INPUT_MISMATCH", "INPUT_MISMATCH", False, False, False),
        (409, "ARTIFACT_MISMATCH", "ARTIFACT_MISMATCH", False, False, False),
        (409, TOKEN, "UNEXPECTED_CONFLICT", False, False, False),
        (404, "JOB_NOT_FOUND", "JOB_NOT_FOUND", False, False, False),
        (503, TOKEN, "DEPENDENCY_UNAVAILABLE", False, False, True),
        (422, TOKEN, "INVALID_RESPONSE", False, False, False),
    ],
)
def test_upstream_errors_are_bounded_machine_codes(
    status, message, code, superseded, lease_lost, retryable
):
    async def scenario():
        client = OutcomeAPIClient(
            "http://api:9100",
            SecretStr(TOKEN),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    status, json=envelope(None, code=status, message=message)
                )
            ),
        )
        try:
            with pytest.raises(OutcomeAPIError) as caught:
                await client.claim("test")
            assert str(caught.value) == code
            assert caught.value.superseded is superseded
            assert caught.value.lease_lost is lease_lost
            assert caught.value.retryable is retryable
            assert TOKEN not in str(caught.value)
        finally:
            await client.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "body",
    ["not-json", "[]", "null", "x" * 40_000, '{"code":200}'],
    ids=["text", "array", "null", "oversized", "missing_data"],
)
def test_malformed_or_oversized_responses_do_not_escape_protocol(body):
    async def scenario():
        client = OutcomeAPIClient(
            "http://api:9100",
            SecretStr(TOKEN),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, content=body)
            ),
        )
        try:
            with pytest.raises(OutcomeAPIError, match="INVALID_RESPONSE"):
                await client.claim("test")
        finally:
            await client.close()

    asyncio.run(scenario())


def test_redirect_never_forwards_internal_credential():
    async def scenario():
        requests = []

        def handle(request):
            requests.append(request)
            return httpx.Response(
                307, headers={"Location": "https://attacker.invalid/capture"}
            )

        client = OutcomeAPIClient(
            "http://api:9100", SecretStr(TOKEN), transport=httpx.MockTransport(handle)
        )
        try:
            with pytest.raises(OutcomeAPIError):
                await client.claim("test")
            assert len(requests) == 1
            assert requests[0].url.host == "api"
        finally:
            await client.close()

    asyncio.run(scenario())


def test_claim_rejects_projection_identity_or_rejection_branch_mismatch():
    for field, value in [("caseId", "other"), ("revision", 2), ("inputHash", "b" * 64)]:
        with pytest.raises(ValidationError):
            OutcomeClaim.model_validate(claim_data(**{field: value}))
    data = claim_data()
    data["context"]["analysisKind"] = "REJECTION_CAUSES"
    with pytest.raises(ValidationError):
        OutcomeClaim.model_validate(data)
