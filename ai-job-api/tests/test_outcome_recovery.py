import asyncio
import importlib.util
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from test_outcomes import INTERNAL, claim, ingest, observation, operation, save
from test_outcomes import outcome_client as outcome_client

from job_helper_api.database import dumps
from job_helper_api.rejection_engine.service import digest


@pytest.fixture(scope="module")
def protocol():
    # Load the real 9101 strict protocol models, without adding Agent runtime dependencies.
    path = Path(__file__).parents[2] / "ai-job-agent/src/job_helper_agent/outcome_client.py"
    spec = importlib.util.spec_from_file_location("outcome_protocol_for_integration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def expire(world, job):
    with sqlite3.connect(world["path"]) as db:
        db.execute("UPDATE outcome_job SET lease_until=1 WHERE id=?", (job["jobId"],))


def test_save_before_interrupt_crash_reclaims_same_artifact_and_report(
    outcome_client, world, protocol
):
    client = outcome_client
    ingest(client, observation("这个岗位已经招满了。"))
    job = claim(client)
    protocol.OutcomeClaim.model_validate(job)
    artifact, saved = save(client, job)
    protocol.Publication.model_validate(saved)
    expire(world, job)
    assert operation(client, job, "commit", artifactId=artifact).status_code == 409
    resumed = claim(client)
    assert resumed["jobId"] == job["jobId"] and resumed["reportId"] == saved["reportId"]
    assert resumed["executionMode"] == "START" and resumed["leaseToken"] != job["leaseToken"]
    assert operation(client, job, "renew").status_code == 409
    artifact2, saved2 = save(client, resumed)
    protocol.Publication.model_validate(saved2)
    assert artifact2 == artifact and saved2["reportId"] == saved["reportId"]
    assert len(world["fake"].calls) == 1
    parked = operation(
        client, resumed, "park", artifactId=artifact, interruptId="durable-interrupt"
    )
    protocol.ParkReceipt.model_validate(parked.json()["data"])
    assert claim(client) is None
    client.post(
        f"/api/job/outcomes/reports/{saved['reportId']}/feedback",
        json={"requestId": "human", "action": "CONFIRM"},
    )
    confirmed = claim(client)
    protocol.OutcomeClaim.model_validate(confirmed)
    completion = operation(
        client,
        confirmed,
        "complete",
        artifactId=artifact,
        feedbackId=confirmed["humanFeedback"]["feedbackId"],
    )
    protocol.Completion.model_validate(completion.json()["data"])
    with sqlite3.connect(world["path"]) as db:
        assert db.execute("SELECT COUNT(*) FROM outcome_report").fetchone() == (1,)


@pytest.mark.parametrize("tamper", ["quote", "reason", "classification", "unknown", "evidenceRole"])
def test_independent_validation_rejects_tampering_even_with_recomputed_hash(
    outcome_client, world, protocol, tamper
):
    client = outcome_client
    ingest(client, observation("这个岗位已经招满了。"))
    job = claim(client)
    analyzed = operation(client, job, "analyze", analysisKind="REJECTION_CAUSES").json()["data"]
    protocol.Artifact.model_validate(analyzed)
    with sqlite3.connect(world["path"]) as db:
        artifact = json.loads(
            db.execute(
                "SELECT artifact_json FROM outcome_job WHERE id=?", (job["jobId"],)
            ).fetchone()[0]
        )
        report = artifact["report"]
        if tamper == "quote":
            report["evidence"][0]["text"] = "候选人的学历不符合要求"
        elif tamper == "reason":
            report["explicitReasons"][0]["reason"] = "HR因为年龄拒绝"
        elif tamper == "classification":
            report["explicitReasons"][0]["classification"] = "INFERRED"
        elif tamper == "unknown":
            report["unknowns"].append({"execute": "instructions"})
        else:
            report["evidence"][0]["source"] = "USER_DIALOGUE"
        artifact["contentHash"] = digest(report)
        db.execute(
            "UPDATE outcome_job SET artifact_json=? WHERE id=?", (dumps(artifact), job["jobId"])
        )
    response = operation(client, job, "validate", artifactId=analyzed["artifactId"])
    protocol.InvalidArtifact.model_validate(response.json()["data"])
    assert response.json()["data"]["valid"] is False
    assert operation(client, job, "commit", artifactId=analyzed["artifactId"]).status_code == 409
    task = client.get(f"/api/job/outcomes/tasks/{job['jobId']}").json()["data"]
    assert task["status"] == "FAILED" and task["lastErrorCode"] == "INVALID_ARTIFACT"


def test_model_selected_findings_pass_independent_evidence_validation(outcome_client, world):
    world[
        "fake"
    ].output = '{"findings":[{"code":"SALARY","classification":"EXPLICIT","citations":[{"evidenceId":"D1","quote":"您的薪资期望太高，我们不考虑了。"}]}]}'
    ingest(outcome_client, observation("您的薪资期望太高，我们不考虑了。"))
    _, saved = save(outcome_client, claim(outcome_client))
    case = outcome_client.get(f"/api/job/outcomes/cases/{saved['caseId']}").json()["data"]
    assert case["report"]["analysisSource"] == "RULES_AI"


def test_new_material_revision_discards_old_lease_and_preserves_feedback_history(outcome_client):
    client = outcome_client
    item = observation("这个岗位已经招满了。")
    ingest(client, item)
    job = claim(client)
    artifact, saved = save(client, job)
    ingest(
        client,
        observation(
            "明天方便来面试吗？",
            event="new-offer",
            message="new-offer",
            stamp=item["observedAt"] + 1000,
        ),
    )
    assert (
        operation(client, job, "commit", artifactId=artifact).json()["message"]
        == "REVISION_SUPERSEDED"
    )
    response = client.post(
        f"/api/job/outcomes/reports/{saved['reportId']}/feedback",
        json={"requestId": "old-feedback", "action": "IGNORE"},
    )
    assert response.status_code == 200
    new_job = claim(client)
    assert new_job["revision"] == 2 and new_job["humanFeedback"] is None
    assert new_job["context"]["outcome"] == "POSITIVE"
    history = client.get(f"/api/job/outcomes/cases/{saved['caseId']}/history").json()["data"]
    assert history["reports"][0]["feedbackStatus"] == "IGNORED"


def test_concurrent_claim_and_analyze_are_single_execution(outcome_client, world):
    client = outcome_client
    ingest(client, observation("岗位已经招满了"))
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(lambda _: claim(client), range(2)))
    job = next(j for j in jobs if j)
    assert sum(j is not None for j in jobs) == 1
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda _: operation(client, job, "analyze", analysisKind="REJECTION_CAUSES"),
                range(2),
            )
        )
    assert all(r.status_code == 200 for r in results)
    assert results[0].json()["data"]["artifactId"] == results[1].json()["data"]["artifactId"]
    assert len(world["fake"].calls) == 1


def test_model_result_is_discarded_when_new_evidence_arrives_in_flight(outcome_client, monkeypatch):
    import threading

    import job_helper_api.outcomes.workflow as workflow

    entered, release = threading.Event(), threading.Event()
    original = workflow.compute_report

    async def slow(*args, **kwargs):
        entered.set()
        while not release.is_set():
            await asyncio.sleep(0.005)
        return await original(*args, **kwargs)

    monkeypatch.setattr(workflow, "compute_report", slow)
    client = outcome_client
    item = observation("岗位已经招满了")
    ingest(client, item)
    job = claim(client)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(operation, client, job, "analyze", analysisKind="REJECTION_CAUSES")
        assert entered.wait(3)
        try:
            ingest(
                client,
                observation(
                    "明天来面试吗？", event="later", message="later", stamp=item["observedAt"] + 1
                ),
            )
        finally:
            release.set()
        assert future.result().json()["message"] == "REVISION_SUPERSEDED"
    assert client.get(f"/api/job/outcomes/cases/{job['caseId']}/history").json()["data"] == {
        "reports": []
    }


def test_retry_is_visible_bounded_and_owner_disable_is_immediate(outcome_client, world, protocol):
    client = outcome_client
    ingest(client, observation())
    job = claim(client)
    for attempt in range(5):
        response = operation(client, job, "retry", errorCode="CHECKPOINT_UNAVAILABLE")
        data = response.json()["data"]
        protocol.RetryReceipt.model_validate(data)
        assert data["status"] == ("FAILED" if attempt == 4 else "RETRY")
        with sqlite3.connect(world["path"]) as db:
            db.execute("UPDATE outcome_job SET available_at=1 WHERE id=?", (job["jobId"],))
        if attempt < 4:
            job = claim(client)
    assert claim(client) is None
    with sqlite3.connect(world["path"]) as db:
        db.execute("UPDATE user_info SET is_active=0 WHERE id=3")
    assert (
        client.post(
            "/internal/outcomes/claim", headers=INTERNAL, json={"workerId": "disabled"}
        ).status_code
        == 403
    )


def test_due_timer_wakes_once_without_inventing_offline_observation(outcome_client, monkeypatch):
    from test_outcome_policy import HOUR, NOW, sent

    import job_helper_api.outcomes.storage as storage
    import job_helper_api.outcomes.workflow as workflow

    monkeypatch.setattr(storage, "now_ms", lambda: NOW)
    monkeypatch.setattr(workflow, "now_ms", lambda: NOW)
    ingest(outcome_client, sent())
    first = claim(outcome_client)
    save(outcome_client, first)
    monkeypatch.setattr(storage, "now_ms", lambda: NOW + 72 * HOUR)
    monkeypatch.setattr(workflow, "now_ms", lambda: NOW + 72 * HOUR)
    due = claim(outcome_client)
    assert due["revision"] == 2 and due["context"]["processingStatus"] == "WAITING_OBSERVATION"
    assert due["context"]["outcome"] == "WAITING" and due["context"]["asOf"] == NOW
    assert claim(outcome_client) is None


def test_public_evidence_has_real_message_ids_and_distinct_snapshot_sources(outcome_client):
    from time import time

    assert (
        outcome_client.post(
            "/api/job/ai/applications/snapshot",
            json={
                "encryptJobId": "Job-A",
                "appliedAt": int(time() * 1000),
                "jobBaseInfo": "Python岗位",
                "jobExtInfo": "需要Python经验",
            },
        ).status_code
        == 200
    )
    ingest(outcome_client, observation("岗位已经招满了", message="real-platform-mid"))
    _, saved = save(outcome_client, claim(outcome_client))
    report = outcome_client.get(f"/api/job/outcomes/cases/{saved['caseId']}").json()["data"][
        "report"
    ]
    evidence = report["evidence"]
    chat = next(item for item in evidence if item["source"] == "CHAT")
    assert chat == {
        "evidenceId": "D1",
        "source": "CHAT",
        "role": "HR",
        "messageId": "real-platform-mid",
        "quote": "岗位已经招满了",
    }
    for item in evidence:
        assert set(item) == {"evidenceId", "source", "role", "messageId", "quote"}
        if item["source"] in {"JOB", "RESUME"}:
            assert item["messageId"] is None and item["role"] is None
    ids = {item["evidenceId"] for item in evidence}
    assert all(
        set(reason["evidenceIds"]) <= ids
        for reason in report["explicitReasons"] + report["inferredRisks"]
    )
