import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from test_automation import (
    BASE,
    INTERNAL,
    application_input,
    dispatch,
    executor,
    reply_input,
    response,
    worker,
)
from test_automation import auto as auto

from job_helper_api.automation.storage import digest
from job_helper_api.main import create_app


def acknowledge(client, job, mid="12345", server_mid="67890"):
    scope, action = executor(client, job)
    receipt = dispatch(client, scope, action, mid)
    receipt["serverMid"] = server_mid
    response(client.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    return action


def test_completed_message_still_sets_inbound_time_watermark(auto):
    raw = reply_input("200")
    job = response(auto.post(BASE + "/jobs", json=raw))
    root, body, _ = worker(auto, job)
    acknowledge(auto, job)
    response(auto.post(root + "/complete", json=body, headers=INTERNAL))
    older = reply_input("100")
    older["input"]["inboundSentAt"] = raw["input"]["inboundSentAt"] - 1000
    response(auto.post(BASE + "/jobs", json=older), 409)


@pytest.mark.parametrize("time_kind", ["missing", "equal"])
def test_ambiguous_new_message_durably_fences_unsent_old_draft(auto, time_kind):
    raw = reply_input()
    job = response(auto.post(BASE + "/jobs", json=raw))
    worker(auto, job)
    newer = reply_input("101")
    newer["input"]["inboundSentAt"] = (
        None if time_kind == "missing" else raw["input"]["inboundSentAt"]
    )
    view = response(auto.post(BASE + "/jobs", json=newer))
    assert view["status"] == "UNCERTAIN" and view["lastErrorCode"] == "INBOUND_ORDER_UNCERTAIN"
    old = response(auto.get(BASE + "/jobs/" + job["jobId"]))
    assert old["actions"][0]["status"] == "CANCELLED"
    assert executor(auto, job)[1] is None
    response(
        auto.post(
            "/internal/automation/heartbeat",
            json={"workerId": "worker", "graphVersion": "v1", "lastErrorCode": None},
            headers=INTERNAL,
        )
    )
    assert (
        response(
            auto.post("/internal/automation/claim", json={"workerId": "worker"}, headers=INTERNAL)
        )
        is None
    )


def test_graph_history_never_imports_unbound_legacy_or_other_recruiter(auto, world):
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "INSERT INTO msg_session(user_id,session_key,msg_context,is_active,status) VALUES(3,?,?,1,1)",
            (
                "JobCase:boss-owner",
                json.dumps([{"role": "user", "content": "旧记录私人薪资标记"}], ensure_ascii=False),
            ),
        )
    raw = reply_input()
    raw["input"]["question"] = "A公司私密合同细节"
    job = response(auto.post(BASE + "/jobs", json=raw))
    root, body, _ = worker(auto, job)
    assert "旧记录私人薪资标记" not in json.dumps(world["fake"].calls, ensure_ascii=False)
    acknowledge(auto, job)
    response(auto.post(root + "/complete", json=body, headers=INTERNAL))
    other = reply_input("201", conversationKey="other:security", bossId="other")
    other["input"]["question"] = "B公司岗位安排"
    job_b = response(auto.post(BASE + "/jobs", json=other))
    worker(auto, job_b)
    request = json.dumps(world["fake"].calls[-1], ensure_ascii=False)
    assert "A公司私密合同细节" not in request and "旧记录私人薪资标记" not in request


def test_lost_complete_response_replay_and_process_restart_reconcile(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    root, body, _ = worker(auto, job)
    acknowledge(auto, job)
    expected = response(auto.post(root + "/complete", json=body, headers=INTERNAL))
    assert response(auto.post(root + "/complete", json=body, headers=INTERNAL)) == expected
    with sqlite3.connect(world["path"]) as c:
        c.execute("UPDATE automation_job SET lease_until=1")
    claim = response(
        auto.post("/internal/automation/claim", json={"workerId": "restart"}, headers=INTERNAL)
    )
    assert claim["executionMode"] == "RECONCILE_TERMINAL"
    assert response(auto.get(BASE + "/jobs/" + job["jobId"]))["status"] == "COMPLETED"
    resumed = {**body, "leaseToken": claim["leaseToken"]}
    response(
        auto.post(
            root + "/renew",
            json={k: resumed[k] for k in ("leaseToken", "revision", "inputHash")},
            headers=INTERNAL,
        )
    )
    assert response(auto.post(root + "/complete", json=resumed, headers=INTERNAL)) == expected
    ack = response(auto.post(root + "/graph-complete", json=resumed, headers=INTERNAL))
    assert ack == {"jobId": job["jobId"], "status": "COMPLETED", "graphFinalized": True}
    assert response(auto.post(root + "/graph-complete", json=resumed, headers=INTERNAL)) == ack
    assert (
        response(
            auto.post("/internal/automation/claim", json={"workerId": "restart"}, headers=INTERNAL)
        )
        is None
    )
    response(
        auto.post(
            root + "/complete", json={**resumed, "artifactId": "wrong-artifact"}, headers=INTERNAL
        ),
        409,
    )


def test_configuration_aba_cannot_restore_old_send_authority(auto):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    worker(auto, job)
    scope, action = executor(auto, job)
    for enabled in (False, True):
        response(auto.post("/api/user/save/preference", json={"aiSeatStatus": enabled}))
    response(
        auto.post(
            BASE + "/actions/" + action["actionId"] + "/dispatch",
            json={
                **scope,
                "leaseToken": action["leaseToken"],
                "authorizationRevision": action["authorizationRevision"],
                "clientMid": "12345",
            },
        ),
        409,
    )


def test_independent_validation_rejects_tampered_bound_identity(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    root, body, _ = worker(auto, job, commit=False)
    with sqlite3.connect(world["path"]) as c:
        artifact = json.loads(c.execute("SELECT artifact_json FROM automation_job").fetchone()[0])
        artifact["actions"][0]["payload"]["bossId"] = "another-person"
        artifact["actions"][0]["payloadHash"] = digest(artifact["actions"][0]["payload"])
        c.execute("UPDATE automation_job SET artifact_json=?", (json.dumps(artifact),))
    assert response(auto.post(root + "/validate", json=body, headers=INTERNAL))["valid"] is False
    response(auto.post(root + "/commit", json=body, headers=INTERNAL), 409)


def test_failed_contact_cancels_dependent_greeting_and_finishes_failed(auto):
    job = response(auto.post(BASE + "/jobs", json=application_input()))
    root, body, _ = worker(auto, job)
    scope, action = executor(auto, job, "CONTACT_JOB")
    receipt = dispatch(auto, scope, action, None)
    receipt.update(status="FAILED", platformCode=99, errorCode="PLATFORM_REJECTED")
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    assert response(auto.get(BASE + "/jobs/" + job["jobId"]))["actions"][1]["status"] == "CANCELLED"
    assert (
        response(auto.post(root + "/complete", json=body, headers=INTERNAL))["status"] == "FAILED"
    )


def test_concurrent_compute_uses_one_durable_artifact(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    claim = response(
        auto.post("/internal/automation/claim", json={"workerId": "worker"}, headers=INTERNAL)
    )
    lease = {k: claim[k] for k in ("leaseToken", "revision", "inputHash")}
    url = "/internal/automation/jobs/" + job["jobId"] + "/compute"
    with ThreadPoolExecutor(2) as pool:
        results = list(
            pool.map(lambda _: response(auto.post(url, json=lease, headers=INTERNAL)), range(2))
        )
    assert results[0]["artifactId"] == results[1]["artifactId"]
    assert len(world["fake"].calls) == 1


def test_foreign_owner_cannot_read_or_approve_job(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    worker(auto, job)
    cfg = replace(
        world["settings"],
        owner_user_id=9,
        automation_enabled=True,
        outcome_internal_token=INTERNAL["X-Internal-Token"],
    )
    with TestClient(create_app(cfg, world["transport"])) as other:
        other.headers["Authorization"] = response(
            other.post("/api/user/silently/login", params={"uniqueId": "other-account"})
        )
        response(other.get(BASE + "/jobs/" + job["jobId"]), 404)


def test_expired_compute_without_artifact_is_visible_uncertainty(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    response(auto.post("/internal/automation/claim", json={"workerId": "worker"}, headers=INTERNAL))
    with sqlite3.connect(world["path"]) as c:
        c.execute("UPDATE automation_job SET compute_started=1,lease_until=1")
    assert (
        response(
            auto.post("/internal/automation/claim", json={"workerId": "restart"}, headers=INTERNAL)
        )
        is None
    )
    view = response(auto.get(BASE + "/jobs/" + job["jobId"]))
    assert view["status"] == "UNCERTAIN" and not world["fake"].calls
