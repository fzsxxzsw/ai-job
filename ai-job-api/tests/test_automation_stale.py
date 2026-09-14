import json
import sqlite3
from uuid import uuid4

import pytest
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

from job_helper_api.database import now_ms


def heartbeat(client):
    return response(
        client.post(
            "/internal/automation/heartbeat",
            json={"workerId": "worker", "graphVersion": "v1", "lastErrorCode": None},
            headers=INTERNAL,
        )
    )


def park(client, job):
    root, body, _ = worker(client, job)
    response(
        client.post(
            root + "/park",
            json={**body, "interruptId": "park-" + str(uuid4()), "waitFor": "EXECUTION"},
            headers=INTERNAL,
        )
    )
    return root, body


def epoch(world):
    with sqlite3.connect(world["path"]) as c:
        row = c.execute(
            "SELECT value_json FROM py_api_control WHERE control_key='automation:authority-epoch'"
        ).fetchone()
    return json.loads(row[0]) if row else 0


def job_view(client, job):
    return response(client.get(BASE + "/jobs/" + job["jobId"]))


def test_changed_scope_closes_unsent_waiting_job_without_dispatch(auto):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    park(auto, job)
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    heartbeat(auto)
    view = job_view(auto, job)
    assert view["status"] == "CANCELLED"
    assert view["lastErrorCode"] == "AUTHORIZATION_CHANGED"
    assert view["actions"][0]["status"] == "CANCELLED"
    assert view["actions"][0]["lastErrorCode"] == "AUTHORIZATION_CHANGED"
    assert response(auto.get(BASE + "/status"))["counts"]["waitingExecution"] == 0


def test_expired_compute_without_artifact_stays_uncertain_after_scope_change(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    response(auto.post("/internal/automation/claim", json={"workerId": "worker"}, headers=INTERNAL))
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_job SET compute_started=1,lease_until=1 WHERE id=?",
            (job["jobId"],),
        )
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    heartbeat(auto)
    view = job_view(auto, job)
    assert view["status"] == "UNCERTAIN"
    assert view["lastErrorCode"] == "MODEL_RESULT_UNCERTAIN"


def test_single_session_pause_does_not_revoke_other_job_or_global_epoch(auto, world):
    first = response(auto.post(BASE + "/jobs", json=reply_input()))
    park(auto, first)
    other = reply_input("200", conversationKey="other:security", encryptJobId="AnotherJob")
    other["input"]["jobKey"] = "AnotherJob:boss-owner"
    second = response(auto.post(BASE + "/jobs", json=other))
    park(auto, second)
    before = epoch(world)
    scope, leased = executor(auto, first)
    assert leased["status"] == "LEASED"
    url = "/api/job/seeker/cloned/change/session/status"
    response(auto.post(url, params={"jobKey": "JobCase:boss-owner", "stop": "true"}))
    response(auto.post(url, params={"jobKey": "JobCase:boss-owner", "stop": "false"}))
    assert epoch(world) == before
    response(
        auto.post(
            BASE + "/actions/" + leased["actionId"] + "/dispatch",
            json={
                **scope,
                "leaseToken": leased["leaseToken"],
                "authorizationRevision": leased["authorizationRevision"],
                "clientMid": "12345",
            },
        ),
        409,
    )
    heartbeat(auto)
    assert job_view(auto, first)["status"] == "CANCELLED"
    assert job_view(auto, second)["status"] == "WAITING_EXECUTION"


@pytest.mark.parametrize("kind,minutes", [("REPLY", 11), ("APPLICATION", 6)])
def test_expired_unsent_actions_are_cancelled_but_short_outage_is_not(auto, world, kind, minutes):
    raw = reply_input() if kind == "REPLY" else application_input()
    job = response(auto.post(BASE + "/jobs", json=raw))
    park(auto, job)
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "WAITING_EXECUTION"
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_action SET created_at=? WHERE job_id=?",
            (now_ms() - minutes * 60_000, job["jobId"]),
        )
    heartbeat(auto)
    view = job_view(auto, job)
    assert view["status"] == "CANCELLED"
    assert view["lastErrorCode"] == "ACTION_EXPIRED"
    assert all(a["status"] == "CANCELLED" for a in view["actions"])
    assert response(auto.get(BASE + "/jobs", params={"activeOnly": True})) == []


def test_active_delivery_run_keeps_older_application_until_executor_stops(auto, world):
    job = response(auto.post(BASE + "/jobs", json=application_input()))
    park(auto, job)
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_action SET created_at=? WHERE job_id=?",
            (now_ms() - 6 * 60_000, job["jobId"]),
        )
    executor_state = {
        "executorId": "delivery-page",
        "platformAccount": "boss-owner",
        "capabilities": ["CONTACT_JOB", "SEND_GREETING"],
        "replyEnabled": False,
        "deliveryEnabled": True,
    }
    response(auto.post(BASE + "/executors/heartbeat", json=executor_state))
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "WAITING_EXECUTION"
    response(
        auto.post(
            BASE + "/executors/heartbeat",
            json={**executor_state, "deliveryEnabled": False},
        )
    )
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "CANCELLED"


def test_new_delivery_run_cannot_extend_day_old_application(auto, world):
    job = response(auto.post(BASE + "/jobs", json=application_input()))
    park(auto, job)
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_action SET created_at=? WHERE job_id=?",
            (now_ms() - 25 * 60 * 60_000, job["jobId"]),
        )
    response(
        auto.post(
            BASE + "/executors/heartbeat",
            json={
                "executorId": "new-run",
                "platformAccount": "boss-owner",
                "capabilities": ["CONTACT_JOB", "SEND_GREETING"],
                "replyEnabled": False,
                "deliveryEnabled": True,
            },
        )
    )
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "CANCELLED"


def test_pending_human_approval_does_not_expire_and_approval_gets_fresh_window(auto, world):
    raw = reply_input()
    raw["input"]["exchangeRequest"] = {"kind": "ACCEPT_PHONE", "requestMessageId": "100"}
    job = response(auto.post(BASE + "/jobs", json=raw))
    root, body, _ = worker(auto, job)
    response(
        auto.post(
            root + "/park",
            json={**body, "interruptId": "approval-wait", "waitFor": "CONFIRMATION"},
            headers=INTERNAL,
        )
    )
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_action SET created_at=? WHERE job_id=? AND approval_status='PENDING'",
            (now_ms() - 20 * 60_000, job["jobId"]),
        )
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "WAITING_CONFIRMATION"
    sensitive = next(a for a in job_view(auto, job)["actions"] if a["approvalStatus"] == "PENDING")
    response(
        auto.post(
            BASE + "/actions/" + sensitive["actionId"] + "/approval",
            json={
                "requestId": "approve-late",
                "decision": "APPROVE",
                "payloadHash": sensitive["payloadHash"],
            },
        )
    )
    heartbeat(auto)
    assert job_view(auto, job)["status"] != "CANCELLED"
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_action_event SET created_at=? WHERE id=(SELECT approval_id FROM automation_action WHERE id=?)",
            (now_ms() - 11 * 60_000, sensitive["actionId"]),
        )
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "CANCELLED"


def test_cancelled_pending_action_cannot_be_approved_inside_uncertain_job(auto, world):
    raw = reply_input()
    raw["input"]["exchangeRequest"] = {"kind": "ACCEPT_PHONE", "requestMessageId": "100"}
    job = response(auto.post(BASE + "/jobs", json=raw))
    root, body, _ = worker(auto, job)
    response(
        auto.post(
            root + "/park",
            json={**body, "interruptId": "approval-uncertain", "waitFor": "CONFIRMATION"},
            headers=INTERNAL,
        )
    )
    sensitive = next(a for a in job_view(auto, job)["actions"] if a["approvalStatus"] == "PENDING")
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_action SET status='UNKNOWN' WHERE job_id=? AND id<>?",
            (job["jobId"], sensitive["actionId"]),
        )
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "UNCERTAIN"
    assert (
        next(a for a in job_view(auto, job)["actions"] if a["actionId"] == sensitive["actionId"])[
            "status"
        ]
        == "CANCELLED"
    )
    response(
        auto.post(
            BASE + "/actions/" + sensitive["actionId"] + "/approval",
            json={
                "requestId": "stale-approval",
                "decision": "APPROVE",
                "payloadHash": sensitive["payloadHash"],
            },
        ),
        409,
    )


def test_noop_preference_and_model_saves_do_not_revoke_authority(auto, world):
    initial = epoch(world)
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": True}))
    response(auto.post("/api/user/save/preference", json={"email": "owner@example.test"}))
    assert epoch(world) == initial
    response(auto.post("/api/user/ai/config/temp/save", json={"userPrompt": "简短回答"}))
    first_model_epoch = epoch(world)
    assert first_model_epoch == initial + 1
    response(auto.post("/api/user/ai/config/temp/save", json={"userPrompt": "简短回答"}))
    assert epoch(world) == first_model_epoch
    response(auto.post("/api/user/ai/config/temp/save", json={"userPrompt": "详细回答"}))
    response(auto.post("/api/user/ai/config/temp/save", json={"userPrompt": "简短回答"}))
    assert epoch(world) == first_model_epoch + 2
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": True}))
    assert epoch(world) == first_model_epoch + 4


def test_invalid_current_model_still_allows_stale_cleanup(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    park(auto, job)
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "INSERT INTO user_ai_config(user_id,provider,model_name,api_key,status,test_passed,is_active) "
            "VALUES (3,0,'broken','secret',1,0,1)"
        )
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "CANCELLED"


def test_noop_routing_save_keeps_revision_and_authority_epoch(auto, world):
    current = response(auto.get("/api/user/ai/routing"))["config"]
    initial = epoch(world)
    same = response(auto.post("/api/user/ai/routing", json=current))["config"]
    assert same["revision"] == current["revision"]
    assert epoch(world) == initial
    changed = response(auto.post("/api/user/ai/routing", json={**same, "maxAttempts": 4}))["config"]
    assert changed["revision"] == same["revision"] + 1
    assert epoch(world) == initial + 1
    repeated = response(auto.post("/api/user/ai/routing", json=changed))["config"]
    assert repeated["revision"] == changed["revision"]
    assert epoch(world) == initial + 1


def test_heartbeat_cursor_reaches_beyond_first_200_waiting_jobs(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    park(auto, job)
    with sqlite3.connect(world["path"]) as c:
        c.row_factory = sqlite3.Row
        template = dict(
            c.execute("SELECT * FROM automation_job WHERE id=?", (job["jobId"],)).fetchone()
        )
        action = dict(
            c.execute("SELECT * FROM automation_action WHERE job_id=?", (job["jobId"],)).fetchone()
        )
        for i in range(201):
            duplicate = dict(template)
            duplicate.update(
                id=str(uuid4()),
                business_key=f"duplicate-{i}",
                conversation_key=f"peer-{i}",
                created_at=template["created_at"] - 1_000 + i,
            )
            columns = ",".join(duplicate)
            marks = ",".join("?" for _ in duplicate)
            c.execute(
                f"INSERT INTO automation_job ({columns}) VALUES ({marks})",
                tuple(duplicate.values()),
            )
            copied = dict(action)
            copied.update(id=str(uuid4()), job_id=duplicate["id"])
            columns = ",".join(copied)
            marks = ",".join("?" for _ in copied)
            c.execute(
                f"INSERT INTO automation_action ({columns}) VALUES ({marks})",
                tuple(copied.values()),
            )
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    for _ in range(9):
        heartbeat(auto)
    with sqlite3.connect(world["path"]) as c:
        assert (
            c.execute(
                "SELECT COUNT(*) FROM automation_job WHERE status='WAITING_EXECUTION'"
            ).fetchone()[0]
            == 0
        )
        assert (
            c.execute("SELECT COUNT(*) FROM automation_action WHERE status='QUEUED'").fetchone()[0]
            == 0
        )


def test_late_ack_after_scope_change_can_finish_without_resending(auto):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    root, body = park(auto, job)
    scope, action = executor(auto, job)
    receipt = dispatch(auto, scope, action)
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "UNCERTAIN"
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    assert job_view(auto, job)["status"] == "EXECUTION_READY"
    heartbeat(auto)
    assert job_view(auto, job)["status"] == "EXECUTION_READY"
    claim = response(
        auto.post("/internal/automation/claim", json={"workerId": "worker"}, headers=INTERNAL)
    )
    assert claim["executionMode"] == "RESUME_EXECUTION"
    done = response(
        auto.post(
            root + "/complete", json={**body, "leaseToken": claim["leaseToken"]}, headers=INTERNAL
        )
    )
    assert done["status"] == "COMPLETED"
    assert job_view(auto, job)["actions"][0]["status"] == "ACKNOWLEDGED"


@pytest.mark.parametrize("greeting_failed", [False, True])
def test_partial_application_ack_keeps_sent_action_and_failure_semantics(auto, greeting_failed):
    job = response(auto.post(BASE + "/jobs", json=application_input()))
    park(auto, job)
    scope, contact = executor(auto, job, "CONTACT_JOB")
    receipt = dispatch(auto, scope, contact, None)
    response(auto.post(BASE + "/actions/" + contact["actionId"] + "/receipt", json=receipt))
    if greeting_failed:
        response(
            auto.post(
                BASE + "/actions/" + contact["actionId"] + "/binding",
                json={
                    "requestId": "bind-greeting",
                    "platformAccount": "boss-owner",
                    "bossId": "peer",
                    "conversationKey": "peer:security",
                },
            )
        )
        greeting_scope, greeting = executor(auto, job, "SEND_GREETING")
        failed = dispatch(auto, greeting_scope, greeting)
        failed.update(
            status="FAILED", serverMid=None, platformCode=99, errorCode="PLATFORM_REJECTED"
        )
        response(auto.post(BASE + "/actions/" + greeting["actionId"] + "/receipt", json=failed))
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    heartbeat(auto)
    view = job_view(auto, job)
    assert view["actions"][0]["status"] == "ACKNOWLEDGED"
    assert view["status"] == ("FAILED" if greeting_failed else "CANCELLED")
    if greeting_failed:
        assert view["lastErrorCode"] == "PLATFORM_REJECTED"
        assert view["actions"][1]["status"] == "FAILED"
    else:
        assert view["lastErrorCode"] == "AUTHORIZATION_CHANGED"
        assert view["actions"][1]["status"] == "CANCELLED"


def test_terminal_graph_reconciliation_survives_scope_change(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    root, body, _ = worker(auto, job)
    scope, action = executor(auto, job)
    receipt = dispatch(auto, scope, action)
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    response(auto.post(root + "/complete", json=body, headers=INTERNAL))
    with sqlite3.connect(world["path"]) as c:
        c.execute("UPDATE automation_job SET lease_until=1 WHERE id=?", (job["jobId"],))
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    claim = response(
        auto.post("/internal/automation/claim", json={"workerId": "worker"}, headers=INTERNAL)
    )
    assert claim["executionMode"] == "RECONCILE_TERMINAL"
    assert job_view(auto, job)["status"] == "COMPLETED"
