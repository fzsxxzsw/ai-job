import json
import sqlite3

from fastapi.testclient import TestClient

from job_helper_api.main import create_app

ASK = {
    "question": "你擅长什么？",
    "jobKey": "CaseSensitiveJob:peer",
    "jobInfo": {"jobTitle": "测试岗位"},
}

LEGACY_PAUSE_MARKER = "migration:legacy-session-pauses-v1"
LEGACY_RESUME_MARKER = "migration:legacy-session-resumed-v1"
SESSION_STATUS_PATH = "/api/job/seeker/cloned/change/session/status"


def _set_control(connection, key, value):
    connection.execute(
        "INSERT INTO py_api_control(user_id,control_key,value_json,updated_at) VALUES (3,?,?,1)",
        (key, json.dumps(value, ensure_ascii=False, separators=(",", ":"))),
    )


def _controls(path):
    with sqlite3.connect(path) as connection:
        return {
            key: json.loads(value)
            for key, value in connection.execute(
                "SELECT control_key,value_json FROM py_api_control WHERE user_id=3"
            )
        }


def _insert_terminal_reply_history(connection):
    connection.execute(
        """
        INSERT INTO automation_job(
            id,user_id,business_key,kind,platform_account,conversation_key,revision,
            input_hash,input_json,context_json,status,phase,phase_history_json,
            available_at,attempts,compute_started,graph_finalized,result_json,
            created_at,updated_at
        ) VALUES (
            'legacy-job',3,'legacy-business','REPLY','boss-owner','legacy-a',1,
            'legacy-input-hash','{}','{}','COMPLETED','DONE','[]',1,1,1,1,
            '{"decision":{"code":"SEND"}}',1,1
        )
        """
    )
    connection.execute(
        """
        INSERT INTO automation_action(
            id,user_id,job_id,kind,sequence,status,payload_json,payload_hash,
            approval_status,authorization_revision,client_mid,server_mid,
            finalized,created_at,updated_at
        ) VALUES (
            'legacy-action',3,'legacy-job','SEND_TEXT',0,'ACKNOWLEDGED','{}',
            'legacy-payload-hash','NOT_REQUIRED',1,'legacy-client','legacy-server',1,1,1
        )
        """
    )


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
    assert (
        client.post(SESSION_STATUS_PATH, params={"jobKey": ASK["jobKey"], "stop": True}).json()[
            "data"
        ]
        is True
    )
    with TestClient(create_app(world["settings"], world["transport"])) as restarted:
        restarted.headers["Authorization"] = client.headers["Authorization"]
        assert restarted.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"][
            "answerTypeList"
        ] == [3]
    assert world["fake"].calls == []


def test_global_resume_compensates_legacy_session_stops_once(client, world):
    with sqlite3.connect(world["path"]) as connection:
        _set_control(connection, LEGACY_PAUSE_MARKER, True)
        _set_control(connection, "stop:*", True)
        _set_control(connection, "stop:legacy-a", True)
        _set_control(connection, "stop:legacy-b", False)
        _set_control(connection, "chat-rounds:legacy-a", 9)
        _set_control(connection, "chat-rounds:legacy-b", 3)
        _insert_terminal_reply_history(connection)
        jobs_before = connection.execute("SELECT * FROM automation_job ORDER BY id").fetchall()
        actions_before = connection.execute(
            "SELECT * FROM automation_action ORDER BY id"
        ).fetchall()

    response = client.post(SESSION_STATUS_PATH, params={"jobKey": "globalJobKey", "stop": False})

    assert response.json()["data"] is True
    controls = _controls(world["path"])
    assert controls["stop:*"] is False
    assert controls["stop:legacy-a"] is False
    assert controls["stop:legacy-b"] is False
    assert controls["chat-rounds:legacy-a"] == 0
    assert controls["chat-rounds:legacy-b"] == 0
    marker = controls[LEGACY_RESUME_MARKER]
    assert marker["completed"] is True
    assert marker["authorityEpoch"] > 0
    assert marker["resumedControlCount"] == 1
    with sqlite3.connect(world["path"]) as connection:
        assert (
            connection.execute("SELECT * FROM automation_job ORDER BY id").fetchall() == jobs_before
        )
        assert (
            connection.execute("SELECT * FROM automation_action ORDER BY id").fetchall()
            == actions_before
        )


def test_global_resume_does_not_repeat_legacy_compensation(client, world):
    with sqlite3.connect(world["path"]) as connection:
        _set_control(connection, LEGACY_PAUSE_MARKER, True)
        _set_control(connection, "stop:legacy-a", True)

    assert (
        client.post(SESSION_STATUS_PATH, params={"jobKey": "globalJobKey", "stop": False}).json()[
            "data"
        ]
        is True
    )
    first_controls = _controls(world["path"])
    assert first_controls["stop:legacy-a"] is False
    assert first_controls[LEGACY_RESUME_MARKER]["completed"] is True
    assert (
        client.post(SESSION_STATUS_PATH, params={"jobKey": "current-stop", "stop": True}).json()[
            "data"
        ]
        is True
    )
    with sqlite3.connect(world["path"]) as connection:
        _set_control(connection, "chat-rounds:current-stop", 7)

    assert (
        client.post(SESSION_STATUS_PATH, params={"jobKey": "globalJobKey", "stop": True}).json()[
            "data"
        ]
        is True
    )
    assert (
        client.post(SESSION_STATUS_PATH, params={"jobKey": "globalJobKey", "stop": False}).json()[
            "data"
        ]
        is True
    )

    controls = _controls(world["path"])
    assert controls["stop:current-stop"] is True
    assert controls["chat-rounds:current-stop"] == 7


def test_global_disable_does_not_compensate_legacy_session_stops(client, world):
    with sqlite3.connect(world["path"]) as connection:
        _set_control(connection, LEGACY_PAUSE_MARKER, True)
        _set_control(connection, "stop:legacy-a", True)
        _set_control(connection, "chat-rounds:legacy-a", 9)

    assert (
        client.post(SESSION_STATUS_PATH, params={"jobKey": "globalJobKey", "stop": True}).json()[
            "data"
        ]
        is True
    )

    controls = _controls(world["path"])
    assert controls["stop:*"] is True
    assert controls["stop:legacy-a"] is True
    assert controls["chat-rounds:legacy-a"] == 9
    assert LEGACY_RESUME_MARKER not in controls


def test_global_resume_without_legacy_marker_only_clears_global_stop(client, world):
    with sqlite3.connect(world["path"]) as connection:
        _set_control(connection, "stop:*", True)
        _set_control(connection, "stop:current-stop", True)
        _set_control(connection, "chat-rounds:current-stop", 7)

    assert (
        client.post(SESSION_STATUS_PATH, params={"jobKey": "globalJobKey", "stop": False}).json()[
            "data"
        ]
        is True
    )

    controls = _controls(world["path"])
    assert controls["stop:*"] is False
    assert controls["stop:current-stop"] is True
    assert controls["chat-rounds:current-stop"] == 7
    assert LEGACY_RESUME_MARKER not in controls


def test_debug_does_not_write_conversation(client, world):
    world["fake"].output = "测试回复"
    r = client.post(
        "/api/user/ai/config/debug", json={**ASK, "userPrompt": "只回复测试回复", "messageList": []}
    )
    assert r.json()["data"]["answerContent"] == "测试回复"
    with sqlite3.connect(world["path"]) as c:
        assert c.execute("SELECT COUNT(*) FROM msg_session").fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM py_api_request").fetchone()[0] == 0
