import sqlite3
from itertools import count
from uuid import uuid4

from sqlalchemy import event
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

from job_helper_api.automation import storage as automation_storage
from job_helper_api.database import now_ms


def uncertain_reply(client):
    job = response(client.post(BASE + "/jobs", json=reply_input()))
    root, lease, _ = worker(client, job)
    scope, action = executor(client, job)
    unknown = dispatch(client, scope, action)
    unknown.update(
        status="UNKNOWN",
        serverMid=None,
        platformCode=None,
        errorCode="PLATFORM_RESULT_UNKNOWN",
    )
    response(client.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=unknown))
    parked = response(
        client.post(
            root + "/park",
            json={**lease, "interruptId": "unknown-result", "waitFor": "EXECUTION"},
            headers=INTERNAL,
        )
    )
    assert parked["status"] == "UNCERTAIN"
    return job, action, unknown


def review(client, job_id, reviewed, request_id=None):
    return response(
        client.post(
            BASE + "/jobs/" + job_id + "/review",
            json={"requestId": request_id or str(uuid4()), "reviewed": reviewed},
        )
    )


def test_archiving_unknown_result_only_changes_reminder_and_can_be_undone(auto, world):
    job, action, _ = uncertain_reply(auto)
    job_id = job["jobId"]
    assert response(auto.get(BASE + "/status"))["counts"]["uncertain"] == 1
    assert [item["jobId"] for item in response(auto.get(BASE + "/jobs?activeOnly=true"))] == [
        job_id
    ]

    archived = review(auto, job_id, True, "review-once")
    assert archived["status"] == "UNCERTAIN"
    assert archived["actions"][0]["status"] == "UNKNOWN"
    assert archived["reviewedAt"] > 0
    assert review(auto, job_id, True, "review-once")["reviewedAt"] == archived["reviewedAt"]
    assert review(auto, job_id, True, "review-again")["reviewedAt"] == archived["reviewedAt"]
    counts = response(auto.get(BASE + "/status"))["counts"]
    assert counts["uncertain"] == 0 and counts["reviewedUncertain"] == 1
    assert response(auto.get(BASE + "/jobs?activeOnly=true")) == []
    history = response(auto.get(BASE + "/jobs?activeOnly=false"))
    assert history[0]["jobId"] == job_id and history[0]["reviewedAt"] == archived["reviewedAt"]

    with sqlite3.connect(world["path"]) as c:
        assert (
            c.execute(
                "SELECT status FROM automation_action WHERE id=?", (action["actionId"],)
            ).fetchone()[0]
            == "UNKNOWN"
        )
        assert (
            c.execute(
                "SELECT COUNT(*) FROM automation_action_event WHERE job_id=? AND kind='UNCERTAIN_REVIEW'",
                (job_id,),
            ).fetchone()[0]
            == 2
        )

    restored = review(auto, job_id, False)
    assert restored["reviewedAt"] is None
    assert response(auto.get(BASE + "/status"))["counts"]["uncertain"] == 1
    assert [item["jobId"] for item in response(auto.get(BASE + "/jobs?activeOnly=true"))] == [
        job_id
    ]


def test_late_exact_ack_still_reconciles_after_review(auto):
    job, action, unknown = uncertain_reply(auto)
    review(auto, job["jobId"], True)
    exact = {
        **unknown,
        "requestId": str(uuid4()),
        "status": "ACKNOWLEDGED",
        "serverMid": "67890",
        "platformCode": 0,
        "errorCode": None,
    }
    receipt = response(auto.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=exact))
    assert receipt["status"] == "ACKNOWLEDGED"
    detail = response(auto.get(BASE + "/jobs/" + job["jobId"]))
    assert detail["actions"][0]["status"] == "ACKNOWLEDGED"
    assert detail["status"] == "EXECUTION_READY"
    assert detail["reviewedAt"] is None
    assert response(auto.get(BASE + "/status"))["counts"]["reviewedUncertain"] == 0


def test_new_unknown_action_is_not_hidden_by_previous_review(auto, monkeypatch):
    ticks = count()
    monkeypatch.setattr(automation_storage, "now_ms", lambda: now_ms() + next(ticks))
    job = response(auto.post(BASE + "/jobs", json=application_input()))
    root, lease, _ = worker(auto, job)
    scope, contact = executor(auto, job, "CONTACT_JOB")
    unknown_contact = dispatch(auto, scope, contact, None)
    unknown_contact.update(
        status="UNKNOWN",
        serverMid=None,
        platformCode=None,
        errorCode="PLATFORM_RESULT_UNKNOWN",
    )
    response(auto.post(BASE + "/actions/" + contact["actionId"] + "/receipt", json=unknown_contact))
    response(
        auto.post(
            root + "/park",
            json={**lease, "interruptId": "first-unknown", "waitFor": "EXECUTION"},
            headers=INTERNAL,
        )
    )
    first_review = review(auto, job["jobId"], True)
    assert first_review["reviewedAt"]
    assert response(auto.get(BASE + "/status"))["counts"]["reviewedUncertain"] == 1

    exact_contact = {
        **unknown_contact,
        "requestId": str(uuid4()),
        "status": "ACKNOWLEDGED",
        "platformCode": 0,
        "errorCode": None,
    }
    response(auto.post(BASE + "/actions/" + contact["actionId"] + "/receipt", json=exact_contact))
    response(
        auto.post(
            BASE + "/actions/" + contact["actionId"] + "/binding",
            json={
                "requestId": str(uuid4()),
                "platformAccount": "boss-owner",
                "bossId": "peer",
                "conversationKey": "peer:security",
            },
        )
    )
    _, greeting = executor(auto, job, "SEND_GREETING")
    assert greeting["kind"] == "SEND_GREETING"
    unknown_greeting = dispatch(auto, scope, greeting, "123456")
    unknown_greeting.update(
        status="UNKNOWN",
        serverMid=None,
        platformCode=None,
        errorCode="PLATFORM_RESULT_UNKNOWN",
    )
    response(
        auto.post(BASE + "/actions/" + greeting["actionId"] + "/receipt", json=unknown_greeting)
    )

    detail = response(auto.get(BASE + "/jobs/" + job["jobId"]))
    assert detail["status"] == "UNCERTAIN"
    assert detail["reviewedAt"] is None
    assert response(auto.get(BASE + "/status"))["counts"]["uncertain"] == 1
    assert [item["jobId"] for item in response(auto.get(BASE + "/jobs?activeOnly=true"))] == [
        job["jobId"]
    ]
    second_review = review(auto, job["jobId"], True)
    assert second_review["reviewedAt"]
    assert response(auto.get(BASE + "/status"))["counts"]["reviewedUncertain"] == 1


def test_review_rejects_jobs_without_unknown_result(auto):
    job = response(auto.post(BASE + "/jobs", json=reply_input()))
    response(
        auto.post(
            BASE + "/jobs/" + job["jobId"] + "/review",
            json={"requestId": str(uuid4()), "reviewed": True},
        ),
        409,
    )


def test_list_fetches_review_markers_once_for_a_page(auto):
    unknown, _, _ = uncertain_reply(auto)
    review(auto, unknown["jobId"], True)
    for index in range(3):
        response(
            auto.post(
                BASE + "/jobs",
                json=reply_input(
                    str(200 + index),
                    conversationKey=f"peer:batch-{index}",
                    bossId=f"batch-{index}",
                ),
            )
        )

    review_queries = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        if (
            statement.lstrip().upper().startswith("SELECT")
            and "py_api_control" in statement
            and "control_key IN" in statement
        ):
            review_queries.append(statement)

    engine = auto.app.state.db.engine.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        jobs = response(auto.get(BASE + "/jobs?activeOnly=false"))
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert len(jobs) == 4
    assert len(review_queries) == 1
    assert next(job for job in jobs if job["jobId"] == unknown["jobId"])["reviewedAt"]
    assert all(job["reviewedAt"] is None for job in jobs if job["jobId"] != unknown["jobId"])


def test_empty_list_skips_review_marker_lookup(auto):
    review_queries = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        if "py_api_control" in statement and "control_key IN" in statement:
            review_queries.append(statement)

    engine = auto.app.state.db.engine.sync_engine
    event.listen(engine, "before_cursor_execute", capture)
    try:
        assert response(auto.get(BASE + "/jobs?activeOnly=false")) == []
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert review_queries == []
