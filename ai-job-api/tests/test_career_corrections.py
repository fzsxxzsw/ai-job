import sqlite3

from test_automation import response
from test_career import CAREER, contact, saved_review, version
from test_career import career as career

from job_helper_api.database import now_ms


def test_inferred_or_later_correction_does_not_erase_confirmed_cutoff_evidence(career, world):
    contact(career, world)
    app = response(career.get(CAREER + "/applications"))[0]
    path = CAREER + "/applications/" + app["applicationId"]
    timestamp = now_ms()
    event = {
        "requestId": "confirmed",
        "eventType": "REJECTED",
        "occurredAt": timestamp,
        "confirmation": "USER_CONFIRMED",
        "evidence": {"source": "USER_CONFIRMATION", "quote": "目前岗位不合适"},
        "supersedesEventId": None,
    }
    original = response(career.post(path + "/events", json=event))
    response(
        career.post(
            path + "/events",
            json={
                **event,
                "requestId": "inferred",
                "eventType": "CORRECTION",
                "confirmation": "INFERRED",
                "supersedesEventId": original["eventId"],
            },
        )
    )
    assert response(career.get(path))["outcome"] == "REJECTED"
    # A different confirmed event followed by a later correction exercises the saved cutoff.
    original2 = response(
        career.post(path + "/events", json={**event, "requestId": "another-confirmed"})
    )
    response(
        career.post(
            path + "/events",
            json={
                **event,
                "requestId": "future-correction",
                "occurredAt": timestamp + 1,
                "eventType": "CORRECTION",
                "supersedesEventId": original2["eventId"],
            },
        )
    )
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_job SET status='WAITING_EXECUTION',lease_token=NULL,lease_until=NULL WHERE kind='APPLICATION'"
        )
    _, _, _, view = saved_review(career, cutoff=timestamp)
    ids = {e["eventId"] for e in view["review"]["evidence"]}
    assert original["eventId"] in ids and original2["eventId"] in ids


def test_resume_content_preserves_boundary_whitespace_and_rejects_blank(career):
    text = "  原始履历。\n\n"
    value = version(career, text)
    assert value["content"] == text
    response(
        career.post(
            CAREER + "/resumes/versions",
            json={"requestId": "blank", "content": " \n\t", "facts": []},
        ),
        422,
    )


def test_confirmed_correction_can_follow_inferred_but_cannot_fork(career, world):
    contact(career, world)
    app = response(career.get(CAREER + "/applications"))[0]
    path = CAREER + "/applications/" + app["applicationId"]
    event = {
        "requestId": "original",
        "eventType": "REJECTED",
        "occurredAt": now_ms(),
        "confirmation": "USER_CONFIRMED",
        "evidence": {"source": "USER_CONFIRMATION", "quote": "原始反馈"},
        "supersedesEventId": None,
    }
    original = response(career.post(path + "/events", json=event))
    correction = {**event, "eventType": "CORRECTION", "supersedesEventId": original["eventId"]}
    response(
        career.post(
            path + "/events",
            json={**correction, "requestId": "inference", "confirmation": "INFERRED"},
        )
    )
    confirmed = {**correction, "requestId": "confirmation"}
    saved = response(career.post(path + "/events", json=confirmed))
    assert response(career.post(path + "/events", json=confirmed)) == saved
    response(career.post(path + "/events", json={**confirmed, "requestId": "fork"}), 409)
    history = response(career.get(path))["events"]
    assert len(history) == 4  # The contact ACK plus all three immutable correction records.
