import json
import sqlite3


def test_status_counts_actual_owner_tasks_not_reports_and_does_not_write(client, world):
    states = ["COMPLETED"] * 11 + ["WAITING_CONFIRMATION", "CONFIRMATION_READY", "FAILED"]
    with sqlite3.connect(world["path"]) as db:
        for index, status in enumerate(states + ["COMPLETED"]):
            uid = 9 if index == len(states) else 3
            db.execute(
                """INSERT INTO outcome_job
                (id,user_id,case_id,revision,status,phase,phase_history_json,
                 available_at,attempts,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    f"task-{index:02}",
                    uid,
                    f"case-{index}",
                    1,
                    status,
                    status,
                    json.dumps([{"phase": "COLLECTING", "at": 1}, {"phase": status, "at": 2}]),
                    0,
                    1,
                    1,
                    index + 2,
                ),
            )
        before = list(db.iterdump())
    result = client.get("/api/job/automation/status")
    assert result.status_code == 200
    data = result.json()["data"]
    assert data["counts"]["completed"] == 0
    assert data["outcomes"]["reportCount"] == 0
    tasks = data["outcomes"]["tasks"]
    assert tasks["total"] == 14
    assert tasks["counts"] == {
        "COMPLETED": 11,
        "WAITING_CONFIRMATION": 1,
        "CONFIRMATION_READY": 1,
        "FAILED": 1,
    }
    assert len(tasks["items"]) == 10
    assert [item["jobId"] for item in tasks["items"]] == [f"task-{i:02}" for i in range(13, 3, -1)]
    assert tasks["items"][0]["phaseHistory"][-1]["phase"] == "FAILED"
    assert all(item["jobId"] != "task-14" for item in tasks["items"])
    assert "context_json" not in tasks["items"][0]
    with sqlite3.connect(world["path"]) as db:
        assert list(db.iterdump()) == before


def test_status_reports_empty_task_population_explicitly(client):
    result = client.get("/api/job/automation/status")
    assert result.status_code == 200
    assert result.json()["data"]["outcomes"]["tasks"] == {"counts": {}, "total": 0, "items": []}
