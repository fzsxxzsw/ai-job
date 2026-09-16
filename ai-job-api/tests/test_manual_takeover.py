import json
import sqlite3
from uuid import uuid4

from test_automation import BASE, reply_input, response
from test_automation import auto as auto

from job_helper_api.database import now_ms

TAKEOVER = BASE + "/sessions/manual-takeover"


def takeover_input(source=None, **changes):
    source = source or reply_input("100")
    raw = {
        "requestId": "manual-" + str(uuid4()),
        "platformAccount": source["platformAccount"],
        "conversationKey": source["conversationKey"],
        "encryptJobId": source["encryptJobId"],
        "bossId": source["bossId"],
        "jobKey": source["input"]["jobKey"],
        "throughInboundMessageId": source["input"]["inboundMessageId"],
        "throughInboundSentAt": source["input"]["inboundSentAt"],
        "throughInboundText": source["input"]["question"],
        "manualOutboundClientMid": "70001",
        "manualOutboundMessageId": "80001",
        "manualOutboundSentAt": now_ms(),
        "manualText": "我有三年相关项目经验。",
    }
    raw.update(changes)
    return raw


def test_confirmed_manual_takeover_is_idempotent_and_cancels_old_reply(auto, world):
    source = reply_input("100")
    old = response(auto.post(BASE + "/jobs", json=source))
    payload = takeover_input(source)
    result = response(auto.post(TAKEOVER, json=payload))
    assert result["status"] == "ACTIVE"
    assert result["permanentPaused"] is False
    assert result["historyRecorded"] is True
    assert result["cancelledJobCount"] == 1
    assert response(auto.get(BASE + "/jobs/" + old["jobId"]))["status"] == "CANCELLED"

    replay = response(auto.post(TAKEOVER, json=payload))
    assert replay["replayed"] is True
    with sqlite3.connect(world["path"]) as connection:
        state = json.loads(
            connection.execute(
                "SELECT value_json FROM py_api_control WHERE control_key=?",
                ("manual-takeover:JobCase:boss-owner",),
            ).fetchone()[0]
        )
        assert state["status"] == "ACTIVE"
        assert state["throughInboundMessageId"] == "100"
        assert (
            connection.execute(
                "SELECT count(*) FROM conversation_message WHERE message_id IN ('100','80001')"
            ).fetchone()[0]
            == 2
        )


def test_only_strictly_newer_reply_consumes_takeover(auto, world):
    source = reply_input("100")
    response(auto.post(TAKEOVER, json=takeover_input(source)))

    same = reply_input("100")
    same["input"]["inboundSentAt"] = source["input"]["inboundSentAt"]
    response(auto.post(BASE + "/jobs", json=same), 409)

    equal = reply_input("101")
    equal["input"]["inboundSentAt"] = source["input"]["inboundSentAt"]
    response(auto.post(BASE + "/jobs", json=equal), 409)

    newer = reply_input("102")
    newer["input"]["inboundSentAt"] = source["input"]["inboundSentAt"] + 1
    job = response(auto.post(BASE + "/jobs", json=newer))
    assert job["status"] == "READY"
    with sqlite3.connect(world["path"]) as connection:
        state = json.loads(
            connection.execute(
                "SELECT value_json FROM py_api_control WHERE control_key=?",
                ("manual-takeover:JobCase:boss-owner",),
            ).fetchone()[0]
        )
    assert state["status"] == "CONSUMED"
    assert state["consumedByInboundMessageId"] == "102"


def test_permanent_or_legacy_stop_is_observable_and_never_auto_consumed(auto):
    response(
        auto.post(
            "/api/job/seeker/cloned/change/session/status",
            params={"jobKey": "JobCase:boss-owner", "stop": True},
        )
    )
    source = reply_input("100")
    result = response(auto.post(TAKEOVER, json=takeover_input(source)))
    assert result["status"] == "PERMANENT_PAUSED"
    assert result["permanentPaused"] is True
    assert result["compatibility"] == "LEGACY_OR_EXPLICIT_STOP_REQUIRES_RESUME"

    status_payload = {
        key: result["state"][key]
        for key in ("platformAccount", "conversationKey", "encryptJobId", "bossId", "jobKey")
    }
    status = response(auto.post(TAKEOVER + "/status", json=status_payload))
    assert status["permanentPaused"] is True
    newer = reply_input("102")
    newer["input"]["inboundSentAt"] = source["input"]["inboundSentAt"] + 1
    response(auto.post(BASE + "/jobs", json=newer), 409)

    response(
        auto.post(
            "/api/job/seeker/cloned/change/session/status",
            params={"jobKey": "JobCase:boss-owner", "stop": False},
        )
    )
    status = response(auto.post(TAKEOVER + "/status", json=status_payload))
    assert status["permanentPaused"] is False


def test_manual_takeover_rejects_unconfirmed_or_aliased_server_mid(auto):
    payload = takeover_input()
    payload["manualOutboundMessageId"] = payload["manualOutboundClientMid"]
    response(auto.post(TAKEOVER, json=payload), 422)
    payload["manualOutboundMessageId"] = "not-a-number"
    response(auto.post(TAKEOVER, json=payload), 422)
