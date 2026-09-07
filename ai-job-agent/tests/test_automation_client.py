import asyncio
import json

import httpx
import pytest
from job_helper_agent.automation_client import (
    AutomationAPIClient,
    AutomationAPIError,
    AutomationClaim,
    Completed,
)
from job_helper_agent.config import AgentConfig, load_config
from pydantic import SecretStr, ValidationError
from test_automation_worker import LEASE, TOKEN, claim_data, envelope


def test_config_default_off_independent_of_legacy_database_and_environment(monkeypatch):
    assert AgentConfig().automation_enabled is False
    config = AgentConfig(automation_enabled=True, outcome_internal_token=TOKEN)
    assert not config.persistence_enabled
    assert (
        config.automation_scan_seconds == 5
        and config.automation_job_timeout_seconds == 300
    )
    monkeypatch.setenv("AGENT_AUTOMATION_ENABLED", "true")
    monkeypatch.setenv("AGENT_OUTCOME_INTERNAL_TOKEN", TOKEN)
    monkeypatch.setenv("AGENT_AUTOMATION_SCAN_SECONDS", "3")
    monkeypatch.setenv("AGENT_AUTOMATION_JOB_TIMEOUT_SECONDS", "200")
    config = load_config()
    assert config.automation_enabled and config.automation_scan_seconds == 3
    assert config.automation_job_timeout_seconds == 200
    assert TOKEN not in repr(config)


@pytest.mark.parametrize(
    "kwargs",
    [
        {},
        {"outcome_internal_token": "short"},
        {
            "outcome_internal_token": TOKEN,
            "outcome_api_url": "https://private:secret@api.example.invalid",
        },
        {"outcome_internal_token": TOKEN, "automation_scan_seconds": 0},
        {"outcome_internal_token": TOKEN, "automation_job_timeout_seconds": 30},
    ],
)
def test_config_rejects_missing_secrets_unsafe_url_and_unbounded_time(kwargs):
    with pytest.raises((ValidationError, ValueError)):
        AgentConfig(automation_enabled=True, **kwargs)


@pytest.mark.parametrize(
    "mutation",
    [
        {"jobId": "../../private"},
        {"inputHash": "bad"},
        {"leaseToken": ""},
        {"executionMode": "RESUME_EXECUTION"},
        {"revision": 0},
        {
            "context": {
                "schemaVersion": 1,
                "jobKind": "APPLICATION",
                "requiresExecution": True,
                "requiresConfirmation": False,
            }
        },
        {"resumeData": {"receipts": [], "approvals": [], "messageBody": "private"}},
    ],
)
def test_claim_is_strict_and_cannot_include_unbounded_private_projection(mutation):
    with pytest.raises(ValidationError):
        AutomationClaim.model_validate(claim_data(**mutation))


def test_claim_secret_is_runtime_only_and_bounded_action_refs_are_accepted():
    claim = AutomationClaim.model_validate(
        claim_data(
            artifactId="artifact-1",
            executionMode="RESUME_EXECUTION",
            resumeData={
                "receipts": [{"actionId": "action-1", "status": "UNKNOWN"}],
                "approvals": [
                    {
                        "actionId": "action-1",
                        "approvalId": "approval-1",
                        "decision": "APPROVE",
                    }
                ],
            },
        )
    )
    assert LEASE not in repr(claim) and LEASE not in claim.model_dump_json()
    assert claim.lease_payload()["leaseToken"] == LEASE


@pytest.mark.parametrize(
    "status,wait",
    [
        ("COMPLETED", "NONE"),
        ("FAILED", "NONE"),
        ("UNCERTAIN", "NONE"),
        ("RUNNING", "EXECUTION"),
        ("RUNNING", "CONFIRMATION"),
    ],
)
def test_completion_coherent_statuses(status, wait):
    assert (
        Completed.model_validate(
            {
                "jobId": "job-1",
                "status": status,
                "resultId": "artifact-1",
                "waitFor": wait,
            }
        ).status
        == status
    )


@pytest.mark.parametrize(
    "status,wait",
    [
        ("COMPLETED", "EXECUTION"),
        ("FAILED", "CONFIRMATION"),
        ("UNCERTAIN", "EXECUTION"),
        ("RUNNING", "NONE"),
    ],
)
def test_completion_does_not_conflate_pending_with_terminal(status, wait):
    with pytest.raises(ValidationError):
        Completed.model_validate(
            {"jobId": "job-1", "status": status, "resultId": None, "waitFor": wait}
        )


@pytest.mark.parametrize(
    "http_status,code,expected,retryable,lost",
    [
        (401, TOKEN, "INTERNAL_UNAUTHORIZED", False, False),
        (409, "LEASE_LOST", "LEASE_LOST", False, True),
        (409, "JOB_NOT_RUNNABLE", "JOB_NOT_RUNNABLE", False, True),
        (409, "INPUT_CHANGED", "INPUT_CHANGED", False, False),
        (409, "ANALYSIS_BUSY", "ANALYSIS_BUSY", True, False),
        (503, TOKEN, "WORKER_UNAVAILABLE", True, False),
        (503, "MODEL_UNAVAILABLE", "MODEL_UNAVAILABLE", True, False),
        (504, "MODEL_TIMEOUT", "MODEL_TIMEOUT", True, False),
        (422, TOKEN, "INVALID_RESPONSE", False, False),
    ],
)
def test_http_errors_are_safe_fixed_codes(http_status, code, expected, retryable, lost):
    async def scenario():
        client = AutomationAPIClient(
            "http://api:9100",
            SecretStr(TOKEN),
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    http_status, json=envelope(None, http_status, code)
                )
            ),
        )
        try:
            with pytest.raises(AutomationAPIError) as raised:
                await client.claim("test-worker")
            assert raised.value.code == expected and raised.value.retryable == retryable
            assert raised.value.lease_lost == lost and TOKEN not in str(raised.value)
        finally:
            await client.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "operation,data,expected",
    [
        (
            "gather",
            {
                "jobId": "other-owner-job",
                "inputHash": "a" * 64,
                "ready": True,
                "artifactId": None,
            },
            "INVALID_RESPONSE",
        ),
        (
            "gather",
            {
                "jobId": "job-1",
                "inputHash": "b" * 64,
                "ready": True,
                "artifactId": None,
            },
            "INPUT_CHANGED",
        ),
        (
            "validate",
            {
                "jobId": "job-1",
                "artifactId": "other-artifact",
                "valid": True,
                "errorCode": None,
            },
            "INVALID_RESPONSE",
        ),
        (
            "validate",
            {
                "jobId": "job-1",
                "artifactId": "artifact-1",
                "valid": True,
                "errorCode": "VALIDATION_FAILED",
            },
            "INVALID_RESPONSE",
        ),
        (
            "commit",
            {
                "jobId": "job-1",
                "artifactId": "other-artifact",
                "status": "RUNNING",
                "resultId": None,
                "waitFor": "NONE",
            },
            "INVALID_RESPONSE",
        ),
    ],
)
def test_stage_responses_remain_bound_to_job_hash_and_artifact(
    operation, data, expected
):
    async def scenario():
        claim = AutomationClaim.model_validate(claim_data())

        def handle(request):
            payload = json.loads(request.content)
            assert (
                payload["leaseToken"] == LEASE
                and payload["inputHash"] == claim.inputHash
            )
            return httpx.Response(200, json=envelope(data))

        client = AutomationAPIClient(
            "http://api:9100", SecretStr(TOKEN), transport=httpx.MockTransport(handle)
        )
        try:
            with pytest.raises(AutomationAPIError, match=expected):
                method = getattr(client, operation)
                await method(claim) if operation == "gather" else await method(
                    claim, "artifact-1"
                )
        finally:
            await client.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, content=b"x" * 32769),
        httpx.Response(200, json=[]),
        httpx.Response(
            302, headers={"location": "http://other.invalid"}, json=envelope(None)
        ),
        httpx.Response(200, json=envelope({"unexpected": "private"})),
    ],
)
def test_untrusted_responses_are_bounded_and_redirects_not_followed(response):
    async def scenario():
        calls = []

        def handle(request):
            calls.append(request.url)
            return response

        client = AutomationAPIClient(
            "http://api:9100", SecretStr(TOKEN), transport=httpx.MockTransport(handle)
        )
        try:
            with pytest.raises(AutomationAPIError, match="INVALID_RESPONSE"):
                await client.claim("test")
            assert len(calls) == 1
        finally:
            await client.close()

    asyncio.run(scenario())
