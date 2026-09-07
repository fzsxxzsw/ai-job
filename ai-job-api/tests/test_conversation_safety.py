import asyncio
import hashlib
import json
import sqlite3

import pytest
from sqlalchemy import select

from job_helper_api.contracts import AskInput
from job_helper_api.conversation import conversation_reply, safe_history, shape_answer
from job_helper_api.database import Database

ASK = {"jobKey": "MixedCaseJob:peer", "question": "你好"}


@pytest.mark.parametrize(
    "answer,question,expected",
    [
        ("COMMAND_SEND_RESUME", "请发一下附件简历", [2]),
        ("【COMMAND_SEND_RESUME】", "您的简历可以发给我吗？", [2]),
        ("COMMAND_SEND_RESUME", "不需要发简历", [3]),
        ("COMMAND_SEND_RESUME", "您的简历已经收到了", [3]),
        ("COMMAND_SEND_RESUME", "我们已经招满，不用发简历", [3]),
        ("COMMAND_SEND_RESUME", "你的简历不太合适", [3]),
        ("COMMAND_SEND_RESUME", "您的简历写得不错", [3]),
        ("这只是说明COMMAND_SEND_RESUME的含义", "请发简历", [3]),
        ("COMAND_SEND_RESUME", "请发简历", [3]),
        ("COMMAND_HR_REJECT", "你擅长什么？", [3]),
    ],
)
def test_action_commands_require_exact_output_and_explicit_request(answer, question, expected):
    result = shape_answer(answer, question, {"rfE": True, "rf": "感谢告知"})
    assert result["answerTypeList"] == expected
    if expected == [3]:
        assert result["operationTypeList"] == []


def test_rejection_retention_never_attaches_resume():
    result = shape_answer("COMMAND_HR_REJECT", "目前不太合适", {"rfE": True, "rf": "感谢告知"})
    assert result == {"answerTypeList": [1], "answerContent": "感谢告知", "operationTypeList": []}


def test_old_gemini_history_preserves_assistant_role():
    assert safe_history(json.dumps([{"role": "model", "content": "旧版回复"}])) == [
        {"role": "assistant", "content": "旧版回复"}
    ]
    assert safe_history('{"untrusted":"not a history array"}') == []


def test_job_context_is_passed_as_data_not_system_instructions(client, world):
    world["fake"].output = "你好"
    response = client.post(
        "/api/job/seeker/cloned/ask", json={**ASK, "jobInfo": {"jobTitle": "Python开发岗位"}}
    )
    assert response.status_code == 200
    messages = world["fake"].calls[-1]["messages"]
    assert "Python开发岗位" in messages[1]["content"] and messages[1]["role"] == "user"


def test_duplicate_does_not_reappear_after_one_hour_but_new_turn_can_repeat_text(client, world):
    world["fake"].output = "收到"
    first = client.post("/api/job/seeker/cloned/ask", json=ASK)
    assert first.json()["data"]["answerTypeList"] == [1]
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE py_api_request SET updated_at=1")
    assert client.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"]["answerTypeList"] == [
        3
    ]
    next_turn = {**ASK, "question": "请介绍项目"}
    assert client.post("/api/job/seeker/cloned/ask", json=next_turn).json()["data"][
        "answerTypeList"
    ] == [1]
    assert client.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"]["answerTypeList"] == [
        1
    ]
    assert len(world["fake"].calls) == 3


def test_high_interest_round_limit_survives_truncated_history_and_resume(client, world):
    world["fake"].output = "收到"
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "UPDATE user_info SET preference=? WHERE id=3", (json.dumps({"hiaE": True, "crC": 10}),)
        )
    for index in range(10):
        payload = {**ASK, "question": f"第{index}个不同问题"}
        assert client.post("/api/job/seeker/cloned/ask", json=payload).json()["data"][
            "answerTypeList"
        ] == [1]
    assert client.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"]["answerTypeList"] == [
        3
    ]
    assert len(world["fake"].calls) == 10
    client.post(
        "/api/job/seeker/cloned/change/session/status",
        params={"jobKey": ASK["jobKey"], "stop": False},
    )
    # Explicit resume opens a new allowance without deleting conversation history.
    assert client.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"]["answerTypeList"] == [
        1
    ]
    assert len(world["fake"].calls) == 11


def test_unknown_outcome_after_restart_is_not_generated_again(client, world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "INSERT INTO py_api_request VALUES (3,?,?, 'UNKNOWN',NULL,1,1)",
            (ASK["jobKey"], hashlib.sha256(ASK["question"].encode()).hexdigest()),
        )
    assert client.post("/api/job/seeker/cloned/ask", json=ASK).json()["data"]["answerTypeList"] == [
        3
    ]
    assert world["fake"].calls == []


@pytest.mark.parametrize("stop_key", ["stop:MixedCaseJob:peer", "stop:*"])
def test_stop_during_model_call_wins_and_no_history_is_persisted(world, stop_key):
    async def run():
        db = Database(world["settings"].database_url)
        await db.open()
        started, finish = asyncio.Event(), asyncio.Event()

        class WaitingModel:
            async def complete(self, *args, **kwargs):
                started.set()
                await finish.wait()
                return "模型完成的草稿"

        try:
            task = asyncio.create_task(
                conversation_reply(
                    db, WaitingModel(), world["settings"], 3, AskInput.model_validate(ASK)
                )
            )
            await started.wait()
            async with db.engine.begin() as connection:
                await db.set_control(connection, 3, stop_key, True)
            finish.set()
            result = await task
            assert result["answerTypeList"] == [3]
            assert await db.rows(select(db.table("msg_session"))) == []
        finally:
            await db.close()

    asyncio.run(run())


def test_concurrent_same_question_returns_one_sendable_draft(world):
    async def run():
        db = Database(world["settings"].database_url)
        await db.open()

        class Model:
            calls = 0

            async def complete(self, *args, **kwargs):
                self.calls += 1
                await asyncio.sleep(0.02)
                return "收到"

        model = Model()
        try:
            payload = AskInput.model_validate(ASK)
            results = await asyncio.gather(
                *(conversation_reply(db, model, world["settings"], 3, payload) for _ in range(2))
            )
            assert sorted(result["answerTypeList"] for result in results) == [[1], [3]]
            assert model.calls == 1 and db._locks == {}
        finally:
            await db.close()

    asyncio.run(run())
