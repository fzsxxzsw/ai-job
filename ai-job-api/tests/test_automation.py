import json
import sqlite3
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from job_helper_api.database import now_ms
from job_helper_api.main import create_app

INTERNAL = {"X-Internal-Token": "automation-test-token-" * 3}
BASE = "/api/job/automation"


def response(r, expected=200):
    assert r.status_code == expected, r.text
    return r.json().get("data")


@pytest.fixture
def auto(world):
    world["fake"].output = "您好，请问可以介绍一下工作内容吗？"
    cfg = replace(
        world["settings"],
        automation_enabled=True,
        outcome_internal_token=INTERNAL["X-Internal-Token"],
    )
    with TestClient(create_app(cfg, world["transport"])) as client:
        client.headers["Authorization"] = response(
            client.post("/api/user/silently/login", params={"uniqueId": "boss-owner"})
        )
        yield client


def reply_input(mid="100", **changes):
    raw = {
        "requestId": "req-" + str(uuid4()),
        "kind": "REPLY",
        "platformAccount": "boss-owner",
        "conversationKey": "peer:security",
        "bossId": "peer",
        "encryptJobId": "JobCase",
        "input": {
            "inboundMessageId": mid,
            "inboundSentAt": now_ms(),
            "question": "您好，介绍一下您的经验",
            "jobKey": "JobCase:boss-owner",
            "jobInfo": {},
            "exchangeRequest": None,
        },
    }
    raw.update(changes)
    return raw


def application_input():
    return {
        "requestId": str(uuid4()),
        "kind": "APPLICATION",
        "platformAccount": "boss-owner",
        "conversationKey": None,
        "bossId": None,
        "encryptJobId": "ApplyJob",
        "input": {
            "cycleKey": "cycle-1",
            "filterInput": {"resumeMatchEnabled": True},
            "localAssessment": {"passed": True, "reason": "通过"},
            "greeting": {"enabled": True, "text": "您好，我对这个岗位感兴趣。"},
            "preparedResumeVersionId": None,
            "strategyPlanId": None,
        },
    }


def worker(client, job, commit=True):
    claim = response(
        client.post("/internal/automation/claim", json={"workerId": "worker"}, headers=INTERNAL)
    )
    assert claim["jobId"] == job["jobId"]
    lease = {k: claim[k] for k in ("leaseToken", "revision", "inputHash")}
    root = "/internal/automation/jobs/" + job["jobId"]
    response(client.post(root + "/gather", json=lease, headers=INTERNAL))
    artifact = response(client.post(root + "/compute", json=lease, headers=INTERNAL))
    body = {**lease, "artifactId": artifact["artifactId"]}
    valid = response(client.post(root + "/validate", json=body, headers=INTERNAL))
    assert valid["valid"] is True
    saved = response(client.post(root + "/commit", json=body, headers=INTERNAL)) if commit else None
    return root, body, saved


def executor(client, job, capability="SEND_TEXT"):
    scope = {"executorId": "executor", "platformAccount": "boss-owner"}
    response(
        client.post(
            BASE + "/executors/heartbeat",
            json={
                **scope,
                "capabilities": [capability],
                "replyEnabled": True,
                "deliveryEnabled": True,
            },
        )
    )
    action = response(client.post(BASE + "/actions/claim", json={**scope, "jobId": job["jobId"]}))
    return scope, action


def dispatch(client, scope, action, mid="12345"):
    body = {
        **scope,
        "leaseToken": action["leaseToken"],
        "authorizationRevision": action["authorizationRevision"],
        "clientMid": mid,
    }
    ack = response(client.post(BASE + "/actions/" + action["actionId"] + "/dispatch", json=body))
    return {
        **scope,
        "requestId": str(uuid4()),
        "dispatchToken": ack["dispatchToken"],
        "clientMid": mid,
        "status": "ACKNOWLEDGED",
        "serverMid": "67890" if mid else None,
        "platformCode": 0,
        "occurredAt": now_ms(),
        "errorCode": None,
    }


def test_draft_does_not_record_sent_and_early_ack_survives_park(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    root, body, saved = worker(auto, job)
    assert saved["status"] == "RUNNING" and saved["waitFor"] == "EXECUTION"
    with sqlite3.connect(world["path"]) as c:
        assert c.execute("SELECT count(*) FROM msg_session").fetchone()[0] == 0
    scope, action = executor(auto, job)
    assert action["clientMid"] is None
    receipt = dispatch(auto, scope, action)
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    assert (
        response(
            auto.post(
                root + "/park",
                headers=INTERNAL,
                json={**body, "interruptId": "interrupt", "waitFor": "EXECUTION"},
            )
        )["status"]
        == "EXECUTION_READY"
    )
    claim = response(
        auto.post("/internal/automation/claim", headers=INTERNAL, json={"workerId": "worker"})
    )
    assert claim["executionMode"] == "RESUME_EXECUTION"
    complete = response(
        auto.post(
            root + "/complete", headers=INTERNAL, json={**body, "leaseToken": claim["leaseToken"]}
        )
    )
    assert complete["status"] == "COMPLETED"
    with sqlite3.connect(world["path"]) as c:
        assert len(json.loads(c.execute("SELECT msg_context FROM msg_session").fetchone()[0])) == 2
        assert (
            c.execute(
                "SELECT value_json FROM py_api_control WHERE control_key LIKE 'chat-rounds:graph:%'"
            ).fetchone()[0]
            == "1"
        )
    assert len(world["fake"].calls) == 1


def test_stable_mid_dedup_and_request_conflict(auto, world):
    raw = reply_input()
    job = response(auto.post(BASE + "/jobs", json=raw))
    raw["requestId"] = "different-transport"
    assert response(auto.post(BASE + "/jobs", json=raw))["jobId"] == job["jobId"]
    raw["input"]["question"] = "篡改同一消息"
    response(auto.post(BASE + "/jobs", json=raw), 409)
    root, body, _ = worker(auto, job)
    for _ in range(2):
        assert response(
            auto.post(
                root + "/compute",
                json={k: body[k] for k in ("leaseToken", "revision", "inputHash")},
                headers=INTERNAL,
            )
        )["reused"]
        response(auto.post(root + "/commit", json=body, headers=INTERNAL))
    with sqlite3.connect(world["path"]) as c:
        assert c.execute("SELECT count(*) FROM automation_action").fetchone()[0] == 1
    assert len(world["fake"].calls) == 1


@pytest.mark.parametrize("mode", ["cancel", "supersede"])
def test_late_ack_records_actual_sent_after_terminal_job(auto, world, mode):
    raw = reply_input()
    job = response(auto.post(BASE + "/jobs", json=raw))
    worker(auto, job)
    scope, action = executor(auto, job)
    receipt = dispatch(auto, scope, action)
    if mode == "cancel":
        response(
            auto.post(BASE + "/jobs/" + job["jobId"] + "/cancel", json={"requestId": "cancel"})
        )
    else:
        newer = reply_input("101")
        newer["input"]["inboundSentAt"] = raw["input"]["inboundSentAt"] + 1
        response(auto.post(BASE + "/jobs", json=newer))
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    receipt["requestId"] = "late-duplicate"
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    with sqlite3.connect(world["path"]) as c:
        assert (
            c.execute(
                "SELECT value_json FROM py_api_control WHERE control_key LIKE 'chat-rounds:graph:%'"
            ).fetchone()[0]
            == "1"
        )


def test_sensitive_approval_requires_second_execution_wait(auto):
    raw = reply_input()
    raw["input"]["exchangeRequest"] = {"kind": "ACCEPT_PHONE", "requestMessageId": "100"}
    job = response(auto.post(BASE + "/jobs", json=raw))
    root, body, saved = worker(auto, job)
    assert saved["waitFor"] == "CONFIRMATION"
    assert executor(auto, job)[1] is None
    actions = response(auto.get(BASE + "/jobs/" + job["jobId"]))["actions"]
    sensitive = next(a for a in actions if a["kind"] == "ACCEPT_PHONE")
    response(
        auto.post(
            BASE + "/actions/" + sensitive["actionId"] + "/approval",
            json={
                "requestId": "approve",
                "decision": "APPROVE",
                "payloadHash": sensitive["payloadHash"],
            },
        )
    )
    assert (
        response(
            auto.post(
                root + "/park",
                headers=INTERNAL,
                json={**body, "interruptId": "i1", "waitFor": "CONFIRMATION"},
            )
        )["status"]
        == "CONFIRMATION_READY"
    )
    claim = response(
        auto.post("/internal/automation/claim", headers=INTERNAL, json={"workerId": "worker"})
    )
    result = response(
        auto.post(
            root + "/complete", headers=INTERNAL, json={**body, "leaseToken": claim["leaseToken"]}
        )
    )
    assert result["status"] == "RUNNING" and result["waitFor"] == "EXECUTION"


def test_contact_ack_does_not_depend_on_lookup_and_greeting_is_separate(auto):
    job = response(auto.post(BASE + "/jobs", json=application_input()))
    worker(auto, job)
    scope, contact = executor(auto, job, "CONTACT_JOB")
    receipt = dispatch(auto, scope, contact, None)
    response(auto.post(BASE + "/actions/" + contact["actionId"] + "/receipt", json=receipt))
    assert executor(auto, job, "SEND_GREETING")[1] is None
    response(
        auto.post(
            BASE + "/actions/" + contact["actionId"] + "/binding",
            json={
                "requestId": "bind",
                "platformAccount": "boss-owner",
                "bossId": "peer",
                "conversationKey": "peer:security",
            },
        )
    )
    _, greeting = executor(auto, job, "SEND_GREETING")
    assert greeting["kind"] == "SEND_GREETING" and greeting["payload"]["bossId"] == "peer"


@pytest.mark.parametrize("server_mid", [None, "12345", "-1", "not-mid", "０１２", "0"])
def test_text_ack_requires_real_distinct_platform_mid(auto, server_mid):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    worker(auto, job)
    scope, action = executor(auto, job)
    receipt = dispatch(auto, scope, action)
    receipt["serverMid"] = server_mid
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt), 422)


def test_expired_dispatch_is_unknown_and_late_ack_recovers(auto, world):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    root, body, _ = worker(auto, job)
    scope, action = executor(auto, job)
    receipt = dispatch(auto, scope, action)
    with sqlite3.connect(world["path"]) as c:
        c.execute("UPDATE automation_action SET lease_until=1")
    assert (
        response(
            auto.post(
                root + "/park",
                headers=INTERNAL,
                json={**body, "interruptId": "i1", "waitFor": "EXECUTION"},
            )
        )["status"]
        == "UNCERTAIN"
    )
    assert executor(auto, job)[1] is None
    response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    assert response(auto.get(BASE + "/jobs/" + job["jobId"]))["status"] == "EXECUTION_READY"


def test_pause_and_pref_change_block_dispatch(auto):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    worker(auto, job)
    scope, action = executor(auto, job)
    response(auto.post("/api/user/save/preference", json={"aiSeatStatus": False}))
    response(
        auto.post(
            BASE + "/actions/" + action["actionId"] + "/dispatch",
            json={
                **scope,
                "leaseToken": action["leaseToken"],
                "authorizationRevision": action["authorizationRevision"],
                "clientMid": "123",
            },
        ),
        409,
    )


def test_binding_auth_and_old_bypass_fences(auto):
    raw = reply_input()
    raw["input"]["jobKey"] = raw["conversationKey"]
    response(auto.post(BASE + "/jobs", json=raw), 422)
    raw = reply_input(platformAccount="别人的账号")
    raw["input"]["jobKey"] = "JobCase:别人的账号"
    response(auto.post(BASE + "/jobs", json=raw), 403)
    response(auto.post("/api/job/filter/one", json={}), 409)
    response(auto.post("/api/job/seeker/cloned/ask", json={"question": "q", "jobKey": "k"}), 409)
    response(auto.post("/internal/automation/claim", json={"workerId": "worker"}), 401)
    assert response(auto.get(BASE + "/status"))["mode"] == "LANGGRAPH"


def test_missing_materials_is_explicit_no_action_result(auto, world):
    with sqlite3.connect(world["path"]) as c:
        c.execute("UPDATE user_resume SET is_active=0")
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    root, body, saved = worker(auto, job)
    assert saved["waitFor"] == "NONE"
    done = response(auto.post(root + "/complete", headers=INTERNAL, json=body))
    assert done["status"] == "COMPLETED"
    view = response(auto.get(BASE + "/jobs/" + job["jobId"]))
    assert view["decision"]["code"] == "MISSING_MATERIALS" and view["actions"] == []
    assert not world["fake"].calls
