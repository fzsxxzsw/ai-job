def test_known_generation_failure_can_be_retried_without_duplicate_sendable_drafts(client, world):
    payload = {"jobKey": "test-failed-model:peer", "question": "你好"}
    world["fake"].status = 500
    assert client.post("/api/job/seeker/cloned/ask", json=payload).status_code == 502
    world["fake"].status = 200
    world["fake"].output = "已收到。"
    assert client.post("/api/job/seeker/cloned/ask", json=payload).json()["data"][
        "answerTypeList"
    ] == [1]
    assert client.post("/api/job/seeker/cloned/ask", json=payload).json()["data"][
        "answerTypeList"
    ] == [3]
    assert len(world["fake"].calls) == 2
