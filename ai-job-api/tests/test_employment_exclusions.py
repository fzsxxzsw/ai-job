import json
import sqlite3
from pathlib import Path

from job_helper_api.employment_exclusions import match_employment_exclusion

PREF = {
    "fhE": True,
    "employmentExcludeE": True,
    "employmentExcludeKeywords": ["外包", "劳务派遣", "驻场", "外派"],
}


def save(client, pref):
    response = client.post("/api/user/save/preference", json={"preference": pref})
    assert response.status_code == 200
    assert client.post("/api/user/userinfo").json()["data"]["preference"] == pref


def test_shared_keyword_cases():
    for row in json.loads(
        (Path(__file__).parent / "fixtures/employment-exclusions.json").read_text(encoding="utf-8")
    ):
        assert match_employment_exclusion(PREF, row["text"]) == row["hit"]
    assert match_employment_exclusion({}, "外包猎头") is None
    assert match_employment_exclusion({**PREF, "employmentExcludeE": False}, "外包") is None


def test_saved_switches_filter_jd_before_model_and_survive_readback(client, world):
    save(client, PREF)
    for field, value in [
        ("jobBaseInfo", {"goldHunter": 1}),
        ("jobExtInfo", {"postDescription": "软件外包研发"}),
    ]:
        response = client.post(
            "/api/job/filter/one", json={field: json.dumps(value), "resumeMatchEnabled": True}
        )
        assert response.status_code == 200
        assert response.json()["data"]["decisionStatus"] == "REJECT"
        assert response.json()["data"]["engine"] == "LOCAL_EXCLUSIONS"
    assert world["fake"].calls == []


def test_conversation_blocks_followups_actions_and_survives_reloading_settings(client, world):
    save(client, PREF)
    for question in ["我们是外包，能否发一份简历", "方便发简历吗"]:
        data = client.post(
            "/api/job/seeker/cloned/ask", json={"jobKey": "peer-A", "question": question}
        ).json()["data"]
        assert data["answerTypeList"] == [3]
        assert data["answerContent"] == "" and data["operationTypeList"] == []
        assert data["exclusionReason"] == "外包"
    assert world["fake"].calls == []
    with sqlite3.connect(world["path"]) as connection:
        assert connection.execute("SELECT count(*) FROM py_api_request").fetchone()[0] == 0
        assert connection.execute(
            "SELECT value_json FROM py_api_control WHERE control_key='employment-exclusion:peer-A'"
        ).fetchone()
    world["fake"].output = "你好"
    data = client.post(
        "/api/job/seeker/cloned/ask", json={"jobKey": "peer-B", "question": "非外包，公司直招"}
    ).json()["data"]
    assert data["answerTypeList"] == [1]
    save(client, {**PREF, "employmentExcludeE": False})
    data = client.post(
        "/api/job/seeker/cloned/ask", json={"jobKey": "peer-A", "question": "请介绍项目"}
    ).json()["data"]
    assert data["answerTypeList"] == [1]


def test_existing_recruiter_history_blocks_but_own_refusal_does_not(client, world):
    save(client, PREF)
    with sqlite3.connect(world["path"]) as connection:
        for key, role in [("peer-HR", "user"), ("peer-own", "assistant")]:
            connection.execute(
                "INSERT INTO msg_session(user_id,session_key,msg_context,status,is_active) VALUES (3,?,?,1,1)",
                (key, json.dumps([{"role": role, "content": "这是外包"}])),
            )
    world["fake"].output = "你好"
    for key, expected in [("peer-HR", [3]), ("peer-own", [1])]:
        data = client.post(
            "/api/job/seeker/cloned/ask", json={"jobKey": key, "question": "你好"}
        ).json()["data"]
        assert data["answerTypeList"] == expected
