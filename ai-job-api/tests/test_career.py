import json
import sqlite3
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
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

from job_helper_api.database import now_ms
from job_helper_api.main import create_app

CAREER = "/api/job/career"


@pytest.fixture
def career(world):
    settings = replace(
        world["settings"],
        career_enabled=True,
        automation_enabled=True,
        outcome_enabled=True,
        outcome_internal_token=INTERNAL["X-Internal-Token"],
    )
    with TestClient(create_app(settings, world["transport"])) as client:
        client.headers["Authorization"] = response(
            client.post("/api/user/silently/login", params={"uniqueId": "boss-owner"})
        )
        yield client


def version(client, content="项目经历\nPython  开发三年", request_id=None):
    return response(
        client.post(
            CAREER + "/resumes/versions",
            json={
                "requestId": request_id or str(uuid4()),
                "content": content,
                "facts": [],
                "source": "USER_TEXT",
                "parentVersionId": None,
            },
        )
    )


def review(client, version_id=None, **changes):
    body = {
        "requestId": str(uuid4()),
        "windowDays": 14,
        "cutoff": now_ms(),
        "resumeVersionId": version_id,
        "objective": "后端工程师",
        "budget": 2,
        "hardConstraints": {},
    }
    body.update(changes)
    return response(client.post(CAREER + "/reviews", json=body))


def saved_review(client, version_id=None, **changes):
    job = review(client, version_id, **changes)
    root, body, saved = worker(client, job)
    assert saved["waitFor"] == "CONFIRMATION"
    return job, root, body, response(client.get(CAREER + "/reviews/" + job["jobId"]))


def select_version(client, value, base=None):
    return response(
        client.post(
            CAREER + "/resumes/versions/" + value["versionId"] + "/select",
            json={"requestId": str(uuid4()), "baseActiveVersionId": base},
        )
    )


def contact(client, world, raw=None):
    world["fake"].output = '{"filter":false,"reason":"岗位匹配","score":80}'
    raw = raw or application_input()
    raw["input"]["filterInput"].update(
        jobBaseInfo='{"jobName":"工程师"}', jobExtInfo='{"jobDescription":"完整职责 Python 开发"}'
    )
    job = response(client.post(BASE + "/jobs", json=raw))
    root, body, _ = worker(client, job)
    scope, action = executor(client, job, "CONTACT_JOB")
    receipt = dispatch(client, scope, action, None)
    receipt["resolvedBinding"] = {"bossId": "peer", "conversationKey": "peer:security"}
    response(client.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
    return job, root, body, action


def test_versions_are_immutable_owned_prepared_and_selection_cas(career, world):
    a, b = version(career), version(career, "第二份真实资料")
    select_version(career, a)
    response(
        career.post(
            CAREER + "/resumes/versions/" + b["versionId"] + "/select",
            json={"requestId": "stale", "baseActiveVersionId": None},
        ),
        409,
    )
    select_version(career, b, a["versionId"])
    assert response(career.get(CAREER + "/selection"))["preparedResumeVersionId"] == b["versionId"]
    with sqlite3.connect(world["path"]) as c:
        assert (
            c.execute("SELECT resume_content FROM user_resume WHERE user_id=3").fetchone()[0]
            == "测试候选人，Python与Vue项目经验"
        )
        c.execute("UPDATE career_resume_version SET user_id=9 WHERE id=?", (a["versionId"],))
    response(career.get(CAREER + "/resumes/versions/" + a["versionId"]), 404)


def test_review_confirmation_is_separate_from_patch_acceptance_and_early_park(career):
    base = version(career)
    job, root, body, view = saved_review(career, base["versionId"])
    proposal = view["review"]["resumeProposals"][0]
    preview = response(
        career.post(
            CAREER + "/proposals/" + proposal["proposalId"] + "/preview",
            json={"selectedPatchIds": [proposal["patches"][0]["patchId"]]},
        )
    )
    accept = {k: preview[k] for k in ("baseVersionId", "previewHash", "selectedPatchIds")}
    accept["requestId"] = "accept-one"
    accepted = response(
        career.post(CAREER + "/proposals/" + proposal["proposalId"] + "/accept", json=accept)
    )
    assert (
        response(
            career.post(CAREER + "/proposals/" + proposal["proposalId"] + "/accept", json=accept)
        )
        == accepted
    )
    assert accepted["version"]["selected"] is False
    assert response(career.get(CAREER + "/reviews/" + job["jobId"]))["confirmation"] is None
    response(
        career.post(
            CAREER + "/reviews/" + job["jobId"] + "/confirmation",
            json={
                "requestId": "confirm",
                "revision": job["revision"],
                "inputHash": job["inputHash"],
                "decision": "CONFIRM",
            },
        )
    )
    assert (
        response(
            career.post(
                root + "/park",
                headers=INTERNAL,
                json={
                    **body,
                    "interruptId": "real-checkpoint-reference",
                    "waitFor": "CONFIRMATION",
                },
            )
        )["status"]
        == "CONFIRMATION_READY"
    )
    claim = response(
        career.post("/internal/automation/claim", headers=INTERNAL, json={"workerId": "worker"})
    )
    assert (
        claim["executionMode"] == "RESUME_CONFIRMATION"
        and claim["context"]["requiresConfirmation"] is False
    )
    assert claim["resumeData"] == {"receipts": [], "approvals": []}
    body["leaseToken"] = claim["leaseToken"]
    assert (
        response(career.post(root + "/complete", headers=INTERNAL, json=body))["status"]
        == "COMPLETED"
    )
    response(career.post(root + "/graph-complete", headers=INTERNAL, json=body))


@pytest.mark.parametrize(
    "mutation", ["fabricated_fact", "stale_preview", "missing_patch", "cross_request"]
)
def test_patch_acceptance_rejects_unsupported_or_stale_inputs(career, world, mutation):
    base = version(career)
    _, _, _, view = saved_review(career, base["versionId"])
    proposal = view["review"]["resumeProposals"][0]
    path = CAREER + "/proposals/" + proposal["proposalId"]
    selected = [proposal["patches"][0]["patchId"]]
    preview = response(career.post(path + "/preview", json={"selectedPatchIds": selected}))
    payload = {
        "requestId": "accept-request",
        "baseVersionId": base["versionId"],
        "previewHash": preview["previewHash"],
        "selectedPatchIds": selected,
    }
    if mutation == "fabricated_fact":
        with sqlite3.connect(world["path"]) as c:
            data = json.loads(
                c.execute(
                    "SELECT data_json FROM career_resume_proposal WHERE id=?",
                    (proposal["proposalId"],),
                ).fetchone()[0]
            )
            data["patches"][0]["proposedText"] += "，曾在大厂带领一百人"
            c.execute(
                "UPDATE career_resume_proposal SET data_json=? WHERE id=?",
                (json.dumps(data), proposal["proposalId"]),
            )
    elif mutation == "stale_preview":
        payload["previewHash"] = "0" * 64
    elif mutation == "missing_patch":
        payload["selectedPatchIds"] = ["unknown"]
    else:
        response(career.post(path + "/accept", json=payload))
        payload["selectedPatchIds"] = ["other"]
    response(
        career.post(path + "/accept", json=payload), 422 if mutation == "missing_patch" else 409
    )


def test_review_missing_inputs_honest_and_full_jd_positive_negative_frozen(career, world):
    contact(career, world)
    app = response(career.get(CAREER + "/applications"))[0]
    for event_type in ("INTERVIEW_INVITED", "REJECTED"):
        response(
            career.post(
                CAREER + "/applications/" + app["applicationId"] + "/events",
                json={
                    "requestId": str(uuid4()),
                    "eventType": event_type,
                    "occurredAt": now_ms(),
                    "confirmation": "USER_CONFIRMED",
                    "evidence": {"source": "USER_CONFIRMATION", "quote": event_type},
                    "supersedesEventId": None,
                },
            )
        )
    # Contact's greeting is pending, but the independent review can run after its worker lease is parked.
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "UPDATE automation_job SET status='WAITING_EXECUTION',lease_token=NULL,lease_until=NULL WHERE kind='APPLICATION'"
        )
    job, _, _, view = saved_review(career, objective=None, budget=None)
    assert set(view["review"]["strategy"]["missingInputs"]) == {
        "OBJECTIVE",
        "BUDGET",
        "PREPARED_RESUME_VERSION",
    }
    assert len(view["review"]["evidence"]) == 2 and view["review"]["resumeProposals"] == []
    with sqlite3.connect(world["path"]) as c:
        context = json.loads(
            c.execute(
                "SELECT context_json FROM automation_job WHERE id=?", (job["jobId"],)
            ).fetchone()[0]
        )
        assert "完整职责" in context["careerReview"]["jobSamples"][0]["jobExtInfo"]
    current = response(career.get(CAREER + "/applications/" + app["applicationId"]))
    assert current["currentStage"] == "INTERVIEW_INVITED" and current["outcome"] == "REJECTED"


def test_delete_clears_private_and_all_internal_paths_are_fenced(career, world):
    job, root, body, _ = saved_review(career, version(career)["versionId"])
    deleted = response(career.delete(CAREER + "/reviews/" + job["jobId"]))
    assert deleted == {"jobId": job["jobId"], "status": "DELETING", "checkpointDeleted": False}
    for suffix in (
        "gather",
        "compute",
        "validate",
        "commit",
        "complete",
        "graph-complete",
        "renew",
    ):
        request = (
            {k: v for k, v in body.items() if k != "artifactId"}
            if suffix in {"gather", "compute", "renew"}
            else body
        )
        response(career.post(root + "/" + suffix, json=request, headers=INTERNAL), 409)
    with sqlite3.connect(world["path"]) as c:
        row = c.execute(
            "SELECT input_json,context_json,result_json,artifact_json FROM automation_job WHERE id=?",
            (job["jobId"],),
        ).fetchone()
        assert row == ("{}", "{}", None, None)
        assert c.execute("SELECT count(*) FROM career_resume_proposal").fetchone()[0] == 0
        assert c.execute("SELECT count(*) FROM career_resume_version").fetchone()[0] == 1
    lease = response(
        career.post(
            "/internal/automation/cleanup/claim", headers=INTERNAL, json={"workerId": "worker"}
        )
    )
    args = {"jobId": job["jobId"], "leaseToken": lease["leaseToken"], "checkpointDeleted": True}
    path = "/internal/automation/cleanup/" + lease["cleanupId"] + "/complete"
    response(career.post(path, headers=INTERNAL, json=args))
    response(career.post(path, headers=INTERNAL, json=args))
    assert response(career.get(CAREER + "/reviews/" + job["jobId"]))["checkpointDeleted"] is True


def test_cleanup_available_when_career_switch_off(world):
    settings = replace(
        world["settings"],
        automation_enabled=True,
        career_enabled=False,
        outcome_internal_token=INTERNAL["X-Internal-Token"],
    )
    with TestClient(create_app(settings, world["transport"])) as client:
        assert (
            response(
                client.post(
                    "/internal/automation/cleanup/claim",
                    headers=INTERNAL,
                    json={"workerId": "worker"},
                )
            )
            is None
        )


@pytest.mark.parametrize("confirmation", ["OBSERVED", "FILE_VERIFIED"])
def test_public_event_cannot_forge_observed_or_file_verified(career, confirmation):
    response(
        career.post(
            CAREER + "/applications/anything/events",
            json={
                "requestId": "event",
                "eventType": "RESUME_SENT",
                "occurredAt": now_ms(),
                "confirmation": confirmation,
                "evidence": {"source": "USER_NOTE", "quote": "claim"},
                "supersedesEventId": None,
            },
        ),
        422,
    )


@pytest.mark.parametrize(
    "phase,code,status,expected",
    [
        ("BEFORE_PLATFORM_CALL", "AUTHORIZATION_CHANGED", "FAILED", 200),
        ("BEFORE_PLATFORM_CALL", "CONTEXT_LOST", "FAILED", 200),
        ("PLATFORM_RESULT", "AUTHORIZATION_CHANGED", "FAILED", 422),
        ("BEFORE_PLATFORM_CALL", "NETWORK_ERROR", "FAILED", 422),
        ("BEFORE_PLATFORM_CALL", "AUTHORIZATION_CHANGED", "ACKNOWLEDGED", 422),
    ],
)
def test_precise_preflight_abort_contract(career, world, phase, code, status, expected):
    world["fake"].output = "正常回复"
    job = response(career.post(BASE + "/jobs", json=reply_input()))
    worker(career, job)
    scope, action = executor(career, job)
    receipt = dispatch(career, scope, action)
    receipt.update(
        executionPhase=phase, errorCode=code, status=status, platformCode=None, serverMid=None
    )
    response(
        career.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt), expected
    )
    with sqlite3.connect(world["path"]) as c:
        assert c.execute("SELECT count(*) FROM msg_session").fetchone()[0] == 0
