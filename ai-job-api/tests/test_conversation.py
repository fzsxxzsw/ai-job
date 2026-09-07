import json
import sqlite3

from fastapi.testclient import TestClient

from job_helper_api.main import create_app

ASK = {
    "question": "你擅长什么？",
    "jobKey": "CaseSensitiveJob:peer",
    "jobInfo": {"jobTitle": "测试岗位"},
}


def test_current_question_and_old_history_reach_model(client, world):
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "INSERT INTO msg_session(user_id,session_key,msg_context,status,is_active) VALUES (3,?,?,1,1)",
            (
                ASK["jobKey"],
                json.dumps(
                    [
                        {"role": "user", "content": "旧问题"},
                        {"role": "assistant", "content": "旧回答"},
                    ]
                ),
            ),
        )
    world["fake"].output = "我擅长Python应用开发。"
    r = client.post("/api/job/seeker/cloned/ask", json=ASK)
    assert r.json()["data"]["answerContent"] == world["fake"].output
    messages = world["fake"].calls[-1]["messages"]
    assert messages[-1]["content"] == ASK["question"]
    assert messages[-2]["content"] == "旧回答"
    assert "测试候选人" in messages[0]["content"]


def test_duplicate_draft_not_returned_twice_after_restart(client, world):
    world["fake"].output = "已收到。"
    assert client.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"]["answerTypeList"] == [
        1
    ]
    assert client.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"]["answerTypeList"] == [
        3
    ]
    with TestClient(create_app(world["settings"], world["transport"])) as restarted:
        restarted.headers["Authorization"] = client.headers["Authorization"]
        assert restarted.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"][
            "answerTypeList"
        ] == [3]
    assert len(world["fake"].calls) == 1


def test_session_stop_survives_restart(client, world):
    path = "/api/job/seeker/cloned/change/session/status"
    assert client.post(path, params={"jobKey": ASK["jobKey"], "stop": True}).json()["data"] is True
    with TestClient(create_app(world["settings"], world["transport"])) as restarted:
        restarted.headers["Authorization"] = client.headers["Authorization"]
        assert restarted.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"][
            "answerTypeList"
        ] == [3]
    assert world["fake"].calls == []


def test_debug_does_not_write_conversation(client, world):
    world["fake"].output = "测试回复"
    r = client.post(
        "/api/user/ai/config/debug", json={**ASK, "userPrompt": "只回复测试回复", "messageList": []}
    )
    assert r.json()["data"]["answerContent"] == "测试回复"
    with sqlite3.connect(world["path"]) as c:
        assert c.execute("SELECT COUNT(*) FROM msg_session").fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM py_api_request").fetchone()[0] == 0
