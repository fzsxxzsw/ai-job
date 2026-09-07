"""Cross-feature regressions for the outcomes / ModelRouter integration.

Exercises the merged outcomes and model-routing implementations together.
Uses the real HTTP routes and existing fixture helpers from both branches.
"""

import json
import sqlite3
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient
from test_model_routing import login, snapshots, success
from test_outcomes import INTERNAL, TOKEN, claim, ingest, observation, operation, save
from test_rejections import analysis, model_finding

from job_helper_api.main import create_app

FIRST = "qwen-turbo"
SECOND = "qwen-plus-2025-12-01"
REFUSAL = "您的薪资期望太高，我们不考虑了。"


def integration_settings(world, **changes):
    return replace(
        world["settings"],
        **{
            "outcome_enabled": True,
            "outcome_internal_token": TOKEN,
            "model_name": FIRST,
            **changes,
        },
    )


def enabled_pool(client, *, tasks=("analysis",)):
    imported = client.post("/api/user/ai/routing/quotas", json=snapshots(FIRST, SECOND))
    assert imported.status_code == 200, imported.text
    config = imported.json()["data"]["config"]
    config["enabled"] = True
    for row in config["models"]:
        row["tasks"] = list(tasks)
        row["priority"] = 100 if row["id"] == FIRST else 10
    saved = client.post("/api/user/ai/routing", json=config)
    assert saved.status_code == 200, saved.text


def pool_view(client):
    response = client.get("/api/user/ai/routing")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def public_report(client, saved):
    response = client.get(f"/api/job/outcomes/cases/{saved['caseId']}")
    assert response.status_code == 200, response.text
    return response.json()["data"]["report"]


def legacy_payload():
    return {
        "encryptJobId": "Legacy-Routed-Job",
        "conversationKey": "Legacy-Routed-Conversation",
        "completeness": "POSSIBLY_INCOMPLETE",
        "messages": [{"role": "HR", "text": REFUSAL}],
    }


def assert_single_outcome(world):
    with sqlite3.connect(world["path"]) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM outcome_job WHERE artifact_json IS NOT NULL"
        ).fetchone() == (1,)
        assert db.execute("SELECT COUNT(*) FROM outcome_report").fetchone() == (1,)
        assert db.execute("SELECT COUNT(*) FROM rejection_analysis").fetchone() == (0,)


def test_routed_rejection_fallback_reuses_artifact_and_records_actual_legacy_model(world):
    calls = []

    def provider(request):
        name = json.loads(request.content)["model"]
        calls.append(name)
        if name == FIRST:
            return httpx.Response(403, json={"error": {"code": "AllocationQuota.FreeTierOnly"}})
        assert name == SECOND
        return success(model_finding("SALARY", REFUSAL), tokens=42)

    with TestClient(
        create_app(integration_settings(world), httpx.MockTransport(provider))
    ) as client:
        login(client)
        enabled_pool(client)
        ingest(client, observation(REFUSAL))
        job = claim(client)
        assert job["context"]["analysisKind"] == "REJECTION_CAUSES"
        artifact, saved = save(client, job)
        assert public_report(client, saved)["analysisSource"] == "RULES_AI"
        assert_single_outcome(world)
        assert calls == [FIRST, SECOND]
        before_retry = pool_view(client)
        assert [
            (event["model"], event["task"], event["status"]) for event in before_retry["events"]
        ] == [(SECOND, "analysis", "success"), (FIRST, "analysis", "free_quota_exhausted")]
        states = {row["id"]: row for row in before_retry["models"]}
        assert states[FIRST]["remainingTokensEstimate"] == 0
        assert states[SECOND]["reportedTokens"] == 42

        # Lost responses may replay analyze/validate/save, never another reservation.
        artifact_again, saved_again = save(client, job)
        assert artifact_again == artifact and saved_again["reportId"] == saved["reportId"]
        assert calls == [FIRST, SECOND]
        assert pool_view(client) == before_retry
        assert_single_outcome(world)

        manual = analysis(client, legacy_payload())
        assert manual["analysisSource"] == "RULES_AI" and manual["model"] == SECOND
        assert analysis(client, legacy_payload())["id"] == manual["id"]
        assert calls == [FIRST, SECOND, SECOND]
        with sqlite3.connect(world["path"]) as db:
            assert db.execute("SELECT model FROM rejection_analysis").fetchall() == [(SECOND,)]
            assert db.execute("SELECT COUNT(*) FROM outcome_report").fetchone() == (1,)


@pytest.mark.parametrize(
    "failure,expected_outcome_calls,expected_legacy_calls",
    [
        ("invalid_findings", [FIRST], [FIRST]),
        ("no_analysis_candidate", [], []),
        ("authentication", [FIRST], [FIRST]),
        ("all_exhausted", [FIRST, SECOND], []),
    ],
)
def test_routed_analysis_failure_is_rules_only_without_untracked_fallback(
    world, failure, expected_outcome_calls, expected_legacy_calls
):
    calls = []

    def provider(request):
        calls.append(json.loads(request.content)["model"])
        if failure == "authentication":
            return httpx.Response(401, json={"error": {"code": "InvalidApiKey"}})
        if failure == "all_exhausted":
            return httpx.Response(403, json={"error": {"code": "AllocationQuota.FreeTierOnly"}})
        if failure == "no_analysis_candidate":
            pytest.fail("An enabled pool must not contact the default model for an unassigned task")
        return success(model_finding("SALARY", "this quote is absent from the evidence"))

    with TestClient(
        create_app(integration_settings(world), httpx.MockTransport(provider))
    ) as client:
        login(client)
        enabled_pool(
            client, tasks=("greeting",) if failure == "no_analysis_candidate" else ("analysis",)
        )
        ingest(client, observation(REFUSAL))
        job = claim(client)
        artifact, saved = save(client, job)
        report = public_report(client, saved)
        assert report["analysisSource"] == "RULES_ONLY"
        assert any("规则分析" in text for text in report["unknowns"])
        assert calls == expected_outcome_calls
        assert_single_outcome(world)
        before_retry = pool_view(client)
        assert all(event["task"] == "analysis" for event in before_retry["events"])

        repeated = operation(client, job, "analyze", analysisKind="REJECTION_CAUSES")
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()["data"]["artifactId"] == artifact
        assert calls == expected_outcome_calls and pool_view(client) == before_retry

        manual = analysis(client, legacy_payload())
        assert manual["analysisSource"] == "RULES_ONLY" and manual["model"] == "none"
        assert calls == expected_outcome_calls + expected_legacy_calls


def test_both_route_families_keep_login_owner_and_internal_secret_boundaries(world):
    with TestClient(create_app(integration_settings(world), world["transport"])) as client:
        for route in ("/api/user/ai/routing", "/api/job/outcomes/cases"):
            assert client.get(route).status_code == 401
        login(client)
        assert client.get("/api/user/ai/routing").status_code == 200
        assert client.get("/api/job/outcomes/cases").status_code == 200
        # A valid browser login cannot replace the Agent's independent secret.
        assert (
            client.post("/internal/outcomes/claim", json={"workerId": "merge-worker"}).status_code
            == 401
        )
        assert (
            client.post(
                "/internal/outcomes/claim", headers=INTERNAL, json={"workerId": "merge-worker"}
            ).status_code
            == 200
        )
        with sqlite3.connect(world["path"]) as db:
            db.execute("UPDATE user_info SET is_active=0 WHERE id=3")
        for route in ("/api/user/ai/routing", "/api/job/outcomes/cases"):
            assert client.get(route).status_code == 401
        assert (
            client.post(
                "/internal/outcomes/claim", headers=INTERNAL, json={"workerId": "merge-worker"}
            ).status_code
            == 403
        )
        assert world["fake"].calls == []


@pytest.mark.parametrize("mode", ["read_only", "outcomes_disabled"])
def test_router_and_outcomes_preserve_distinct_disable_boundaries(world, mode):
    settings = integration_settings(
        world, read_only=mode == "read_only", outcome_enabled=mode != "outcomes_disabled"
    )
    with TestClient(create_app(settings, world["transport"])) as client:
        login(client)
        for route in ("/api/user/ai/routing", "/api/job/outcomes/cases"):
            assert client.get(route).status_code == 200
        assert (
            client.post(
                "/api/job/outcomes/observations",
                json={"schemaVersion": 1, "observations": [observation(REFUSAL)]},
            ).status_code
            == 503
        )
        assert (
            client.post(
                "/internal/outcomes/claim", headers=INTERNAL, json={"workerId": "merge-worker"}
            ).status_code
            == 503
        )
        response = client.post("/api/user/ai/routing/quotas", json=snapshots(FIRST))
        assert response.status_code == (503 if mode == "read_only" else 200)
        assert world["fake"].calls == []


def test_disabled_router_keeps_default_outcome_analysis_without_pool_reservation(world):
    world["fake"].output = model_finding("SALARY", REFUSAL)
    with TestClient(create_app(integration_settings(world), world["transport"])) as client:
        login(client)
        assert pool_view(client)["config"]["enabled"] is False
        ingest(client, observation(REFUSAL))
        _, saved = save(client, claim(client))
        assert public_report(client, saved)["analysisSource"] == "RULES_AI"
        assert [body["model"] for body in world["fake"].calls] == [FIRST]
        assert pool_view(client)["events"] == []
        assert_single_outcome(world)
