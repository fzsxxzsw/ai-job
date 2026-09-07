import json
import sqlite3
import time

SNAPSHOT = {
    "encryptJobId": "CaseSensitiveJob",
    "appliedAt": int(time.time() * 1000),
    "jobBaseInfo": '{"jobName":"测试岗位"}',
    "jobExtInfo": "{}",
    "preMatchResult": {"decision": "MATCH"},
}
AUDIT = {
    "auditId": "greeting:test",
    "deliveryKey": "test",
    "kind": "greeting",
    "status": "sending",
    "jobTitle": "fixture",
    "contentHash": "5:abc",
    "contentLength": 5,
    "attempts": 1,
    "createdAt": 1700000000000,
    "updatedAt": 1700000000010,
}


def test_snapshot_immutable_and_case_sensitive(client, world):
    a = client.post("/api/job/ai/applications/snapshot", json=SNAPSHOT).json()["data"]
    b = client.post(
        "/api/job/ai/applications/snapshot", json={**SNAPSHOT, "jobExtInfo": "changed"}
    ).json()["data"]
    c = client.post(
        "/api/job/ai/applications/snapshot",
        json={**SNAPSHOT, "encryptJobId": SNAPSHOT["encryptJobId"].lower()},
    ).json()["data"]
    assert a == b and a["id"] != c["id"]


def test_audit_rejects_plaintext_and_incomplete_receipts(client):
    assert (
        client.post(
            "/api/job/delivery/audit", json={**AUDIT, "content": "private text"}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/job/delivery/audit", json={**AUDIT, "status": "receipt"}).status_code
        == 422
    )


def test_audit_dedup_and_receipt_never_roll_back(client, world):
    client.post("/api/job/delivery/audit", json=AUDIT)
    client.post("/api/job/delivery/audit", json=AUDIT)
    receipt = {
        **AUDIT,
        "status": "receipt",
        "updatedAt": 1700000000020,
        "bossId": "peer",
        "conversationKey": "conversation",
        "clientMid": "90071992547409931",
        "serverMid": "90071992547409932",
    }
    assert (
        client.post("/api/job/delivery/audit", json=receipt).json()["data"]["status"] == "receipt"
    )
    assert client.post("/api/job/delivery/audit", json=AUDIT).json()["data"]["status"] == "receipt"
    with sqlite3.connect(world["path"]) as c:
        assert c.execute(
            "SELECT observation_count,duplicate_count,status,server_mid FROM delivery_audit"
        ).fetchone() == (4, 1, "receipt", "90071992547409932")


def test_rejection_requires_snapshot_and_evidence(client, world):
    payload = {
        "encryptJobId": SNAPSHOT["encryptJobId"],
        "conversationKey": "peer",
        "completeness": "POSSIBLY_INCOMPLETE",
        "messages": [{"role": "HR", "text": "目前已招满，联系方式foo@example.com"}],
    }
    without_snapshot = client.post("/api/job/ai/rejections/analyze", json=payload)
    assert without_snapshot.status_code == 200
    assert without_snapshot.json()["data"]["applicationSnapshotId"] is None
    assert without_snapshot.json()["data"]["inferredRisks"] == []
    client.post("/api/job/ai/applications/snapshot", json=SNAPSHOT)
    payload["messages"][0]["text"] = "这个岗位已经招满了，联系方式foo@example.com"
    world["fake"].output = json.dumps(
        {
            "findings": [
                {
                    "code": "POSITION_CLOSED",
                    "classification": "EXPLICIT",
                    "citations": [{"evidenceId": "D1", "quote": "这个岗位已经招满了"}],
                },
                {
                    "code": "SALARY",
                    "classification": "EXPLICIT",
                    "citations": [{"evidenceId": "D99", "quote": "不存在的证据"}],
                },
            ]
        }
    )
    r = client.post("/api/job/ai/rejections/analyze", json=payload)
    data = r.json()["data"]
    assert (
        len(data["explicitReasons"]) == 1
        and data["explicitReasons"][0]["code"] == "POSITION_CLOSED"
    )
    assert "foo@example.com" not in r.text
    assert (
        client.post(
            "/api/job/ai/rejections/" + str(data["id"]) + "/feedback", json={"action": "CONFIRM"}
        ).json()["data"]["status"]
        == "CONFIRMED"
    )
    assert client.get("/api/job/ai/rejections/summary").json()["data"]["visible"] is False


def test_feedback_record_must_belong_to_current_user(client, world):
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "INSERT INTO rejection_analysis(id,user_id,status,analysis_json) VALUES (55,9,'PENDING','{}')"
        )
    assert (
        client.post("/api/job/ai/rejections/55/feedback", json={"action": "CONFIRM"}).status_code
        == 404
    )
