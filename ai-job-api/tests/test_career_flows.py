import json
import sqlite3

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
from test_career import CAREER, contact, saved_review, select_version, version
from test_career import career as career

from job_helper_api.database import now_ms


def park_application(client, root, body):
    response(
        client.post(
            root + "/park",
            headers=INTERNAL,
            json={**body, "waitFor": "EXECUTION", "interruptId": "app-interrupt"},
        )
    )


def test_selected_actual_version_is_frozen_for_filter_and_contact_is_distinct_from_resume(
    career, world
):
    prepared = version(career, "已核实项目：独有 Rust 图计算编译器经验")
    select_version(career, prepared)
    raw = application_input()
    raw["input"]["filterInput"]["prompt"] = "请核对是否有真实项目经历"
    raw["input"]["preparedResumeVersionId"] = prepared["versionId"]
    job, root, body, _ = contact(career, world, raw)
    with sqlite3.connect(world["path"]) as c:
        context = json.loads(
            c.execute(
                "SELECT context_json FROM automation_job WHERE id=?", (job["jobId"],)
            ).fetchone()[0]
        )
        assert context["resume"]["resume_content"] == prepared["content"]
    assert "独有 Rust" in json.dumps(world["fake"].calls, ensure_ascii=False)
    app = response(career.get(CAREER + "/applications"))[0]
    assert app["preparedResumeVersionId"] == prepared["versionId"]
    assert app["resumeExposure"] == {
        "state": "UNKNOWN",
        "resumeVersionId": None,
        "verificationKind": None,
    }
    assert [event["eventType"] for event in app["events"]] == ["CONTACT_INITIATED"]
    assert (
        "当前简历"
        not in response(career.get(CAREER + "/applications/" + app["applicationId"]))["jobExtInfo"]
    )


def test_acknowledged_greeting_enters_exact_conversation_without_reply_round_or_notify(
    career, world
):
    job, root, body, _ = contact(career, world)
    scope, greeting = executor(career, job, "SEND_GREETING")
    receipt = dispatch(career, scope, greeting)
    path = BASE + "/actions/" + greeting["actionId"] + "/receipt"
    response(career.post(path, json=receipt))
    response(career.post(path, json=receipt))
    response(career.post(root + "/complete", headers=INTERNAL, json=body))
    response(career.post(root + "/graph-complete", headers=INTERNAL, json=body))
    world["fake"].output = "可以详细沟通。"
    raw = reply_input(encryptJobId="ApplyJob")
    raw["input"].update(question="可以", jobKey="ApplyJob:boss-owner")
    reply = response(career.post(BASE + "/jobs", json=raw))
    worker(career, reply)
    assert {"role": "assistant", "content": "您好，我对这个岗位感兴趣。"} in world["fake"].calls[
        -1
    ]["messages"]
    with sqlite3.connect(world["path"]) as c:
        assert (
            c.execute(
                "SELECT count(*) FROM py_api_control WHERE control_key LIKE 'chat-rounds:%'"
            ).fetchone()[0]
            == 0
        )
        history = json.loads(c.execute("SELECT msg_context FROM msg_session").fetchone()[0])
        assert len(history) == 1


def test_strategy_apply_reselection_keeps_budget_and_hard_preference(career, world):
    prepared = version(career)
    select_version(career, prepared)
    review, root, body, view = saved_review(career, prepared["versionId"], budget=1)
    strategy = view["review"]["strategy"]
    args = {
        "requestId": "approve",
        "previewHash": strategy["previewHash"],
        "basePreferenceHash": strategy["basePreferenceHash"],
    }
    path = CAREER + "/strategies/" + strategy["strategyId"]
    response(career.post(path + "/apply", json=args), 409)
    response(career.post(path + "/approve", json=args))
    response(career.post(path + "/apply", json={**args, "requestId": "apply-first"}))
    response(
        career.post(
            root + "/park",
            headers=INTERNAL,
            json={**body, "waitFor": "CONFIRMATION", "interruptId": "review-wait"},
        )
    )
    raw = application_input()
    raw["input"].update(
        preparedResumeVersionId=prepared["versionId"], strategyPlanId=strategy["strategyId"]
    )
    _, app_root, app_body, _ = contact(career, world, raw)
    park_application(career, app_root, app_body)
    response(career.post(path + "/apply", json={**args, "requestId": "apply-second-intent"}))
    other = application_input()
    other["encryptJobId"] = "OtherJob"
    other["input"].update(
        preparedResumeVersionId=prepared["versionId"], strategyPlanId=strategy["strategyId"]
    )
    job = response(career.post(BASE + "/jobs", json=other))
    _, _, saved = worker(career, job)
    assert saved["waitFor"] == "NONE"
    final = response(career.get(BASE + "/jobs/" + job["jobId"]))
    assert final["decision"]["code"] == "MISSING_MATERIALS"
    with sqlite3.connect(world["path"]) as c:
        assert json.loads(
            c.execute("SELECT preference FROM user_info WHERE id=3").fetchone()[0]
        ) == {"pi": 15}
        assert (
            sum(
                json.loads(
                    c.execute(
                        "SELECT value_json FROM py_api_control WHERE control_key=?",
                        ("career:budget:" + strategy["strategyId"],),
                    ).fetchone()[0]
                ).values()
            )
            == 1
        )


def test_passive_hr_reply_is_observed_only_for_unique_cycle_and_real_time(career, world):
    _, _, _, _ = contact(career, world)
    app = response(career.get(CAREER + "/applications"))[0]
    timestamp = now_ms()
    observation = {
        "schemaVersion": 1,
        "observations": [
            {
                "eventId": "passive-first",
                "encryptJobId": "ApplyJob",
                "conversationKey": "peer:security",
                "bossId": "peer",
                "source": "BOSS_PASSIVE_MESSAGE",
                "observedAt": timestamp,
                "bindingObservedAt": timestamp,
                "messages": [
                    {
                        "messageId": "hr-mid",
                        "role": "HR",
                        "text": "明天下午可以来面试吗？",
                        "sentAt": timestamp,
                        "deliveryState": "UNKNOWN",
                    }
                ],
                "readEvidence": None,
                "coverage": None,
            }
        ],
    }
    response(career.post("/api/job/outcomes/observations", json=observation))
    response(career.post("/api/job/outcomes/observations", json=observation))
    detail = response(career.get(CAREER + "/applications/" + app["applicationId"]))
    assert [e["eventType"] for e in detail["events"]].count("HR_REPLIED") == 1
    assert not any(e["eventType"] == "INTERVIEW_INVITED" for e in detail["events"])
    observation["observations"][0].update(eventId="time-missing")
    observation["observations"][0]["messages"][0].update(messageId="other-mid", sentAt=None)
    response(career.post("/api/job/outcomes/observations", json=observation))
    assert (
        len(response(career.get(CAREER + "/applications/" + app["applicationId"]))["events"]) == 2
    )


def test_manual_resume_proof_and_correction_preserve_recruiting_stage(career, world):
    contact(career, world)
    app = response(career.get(CAREER + "/applications"))[0]
    prepared = version(career)
    path = CAREER + "/applications/" + app["applicationId"] + "/events"
    base = {
        "requestId": "interview",
        "eventType": "INTERVIEW_INVITED",
        "occurredAt": now_ms(),
        "confirmation": "USER_CONFIRMED",
        "evidence": {"source": "USER_CONFIRMATION", "quote": "HR约面试"},
        "supersedesEventId": None,
    }
    response(career.post(path, json=base))
    sent = response(
        career.post(
            path,
            json={
                **base,
                "requestId": "resume-sent",
                "eventType": "RESUME_SENT",
                "evidence": {
                    "source": "USER_CONFIRMATION",
                    "quote": "我核对文件内容并确认已发此版本",
                    "resumeVersionId": prepared["versionId"],
                    "contentHash": prepared["contentHash"],
                },
            },
        )
    )
    current = response(career.get(CAREER + "/applications/" + app["applicationId"]))
    assert (
        current["currentStage"] == "INTERVIEW_INVITED"
        and current["resumeExposure"]["verificationKind"] == "USER_CONFIRMED"
    )
    response(
        career.post(
            path,
            json={
                **base,
                "requestId": "correct-exposure",
                "eventType": "CORRECTION",
                "supersedesEventId": sent["eventId"],
            },
        )
    )
    assert (
        response(career.get(CAREER + "/applications/" + app["applicationId"]))["resumeExposure"][
            "state"
        ]
        == "UNKNOWN"
    )


def test_import_preserves_captured_resume_and_unknown_actual_exposure(career, world):
    with sqlite3.connect(world["path"]) as c:
        c.execute(
            "INSERT INTO job_application_snapshot(user_id,encrypt_job_id,applied_at,job_base_info,job_ext_info,resume_content,preference_snapshot,created_at) VALUES(3,'legacyCase',1,'{}','{}','旧履历原文','{}',1)"
        )
        c.execute(
            "INSERT INTO job_application_snapshot(user_id,encrypt_job_id,applied_at,job_base_info,job_ext_info,resume_content,created_at) VALUES(9,'other',1,'{}','{}','不属于owner',1)"
        )
    first = response(career.post(CAREER + "/imports/legacy", json={"requestId": "import-1"}))
    again = response(career.post(CAREER + "/imports/legacy", json={"requestId": "import-2"}))
    assert first["importedApplications"] == 1 and again["reusedApplications"] == 1
    app = response(career.get(CAREER + "/applications"))[0]
    assert (
        app["platformAccount"] == "UNKNOWN"
        and app["contactedAt"] is None
        and app["resumeExposure"]["state"] == "UNKNOWN"
    )
    assert (
        response(career.get(CAREER + "/resumes/versions/" + app["preparedResumeVersionId"]))[
            "content"
        ]
        == "旧履历原文"
    )
