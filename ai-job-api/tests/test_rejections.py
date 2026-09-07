"""Business and adversarial regressions migrated from the former Agent gateway."""

import asyncio
import json
import sqlite3
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from job_helper_api import rejections
from job_helper_api.contracts import RejectionInput
from job_helper_api.database import Database
from job_helper_api.main import create_app
from job_helper_api.rejection_engine.evidence import redact
from job_helper_api.rejection_engine.reviewer import validated_findings
from job_helper_api.rejection_engine.rules import analyze_rules

BASE = "/api/job/ai/rejections"
ANALYSIS = {
    "encryptJobId": "JobCase",
    "conversationKey": "peer-job-1",
    "completeness": "POSSIBLY_INCOMPLETE",
    "messages": [{"role": "HR", "text": "这个岗位已经招满了"}],
}


def analysis(client, payload=None):
    response = client.post(BASE + "/analyze", json=payload or ANALYSIS)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def model_finding(code, quote, *, ident="D1", kind="EXPLICIT", extra=None):
    citations = [{"evidenceId": ident, "quote": quote}]
    if extra:
        citations.extend(extra)
    return json.dumps(
        {"findings": [{"code": code, "classification": kind, "citations": citations}]},
        ensure_ascii=False,
    )


def test_dialogue_only_saves_no_fabricated_snapshot(client, world):
    report = analysis(client)
    assert report["applicationSnapshotId"] is None
    assert report["explicitReasons"][0]["code"] == "POSITION_CLOSED"
    assert report["inferredRisks"] == []
    with sqlite3.connect(world["path"]) as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM job_application_snapshot").fetchone()[0] == 0
        )
        assert connection.execute("SELECT COUNT(*) FROM user_resume").fetchone()[0] == 1


def test_duplicate_rejection_and_report_read_survive_restart(client, world):
    report = analysis(client)
    assert analysis(client)["id"] == report["id"]
    with TestClient(create_app(world["settings"], world["transport"])) as restarted:
        restarted.headers["Authorization"] = client.headers["Authorization"]
        assert analysis(restarted)["id"] == report["id"]
        assert restarted.get(BASE + f"/{report['id']}").json()["data"] == report
    assert len(world["fake"].calls) == 1


def test_body_cannot_choose_another_user(client):
    assert client.post(BASE + "/analyze", json={**ANALYSIS, "userId": 9}).status_code == 422


def test_no_hr_evidence_is_rejected(client, world):
    response = client.post(
        BASE + "/analyze",
        json={**ANALYSIS, "messages": [{"role": "USER", "text": "我猜他们不喜欢我"}]},
    )
    assert response.status_code == 422
    assert world["fake"].calls == []


def test_report_feedback_history_summary_are_owner_scoped(client, world):
    report = analysis(client)
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE rejection_analysis SET user_id=9 WHERE id=?", (report["id"],))
    assert client.get(BASE + f"/{report['id']}").status_code == 404
    assert (
        client.post(BASE + f"/{report['id']}/feedback", json={"action": "CONFIRM"}).status_code
        == 404
    )
    assert client.get(BASE + "/history").json()["data"] == []
    assert client.get(BASE + "/summary").json()["data"]["totalConfirmed"] == 0


def test_snapshot_is_immutable_and_model_receives_old_resume_and_full_jd(client, world):
    snapshot = {
        "encryptJobId": "JobCase",
        "appliedAt": int(time.time() * 1000),
        "jobBaseInfo": "Python岗位",
        "jobExtInfo": "要求8年相关经验，必须具备物流行业经验",
        "preMatchResult": None,
    }
    first = client.post("/api/job/ai/applications/snapshot", json=snapshot)
    assert first.status_code == 200, first.text
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "UPDATE user_resume SET resume_content='后来修改的新简历' WHERE user_id=3"
        )
    again = client.post(
        "/api/job/ai/applications/snapshot",
        json={**snapshot, "jobExtInfo": "changed", "appliedAt": 1},
    )
    assert again.json()["data"] == first.json()["data"]
    report = analysis(client)
    evidence = {item["id"]: item["text"] for item in report["evidence"]}
    assert "测试候选人" in evidence["R1"] and evidence["J2"] == snapshot["jobExtInfo"]
    prompt = world["fake"].calls[-1]["messages"][-1]["content"]
    assert "测试候选人" in prompt and "物流行业经验" in prompt and "后来修改的新简历" not in prompt


def test_current_resume_cannot_backfill_historical_snapshot(client):
    payload = {
        "encryptJobId": "old",
        "appliedAt": 1700000000000,
        "jobBaseInfo": "{}",
        "jobExtInfo": "{}",
    }
    assert client.post("/api/job/ai/applications/snapshot", json=payload).status_code == 422


@pytest.mark.parametrize("status", [401, 429, 500])
def test_model_error_is_saved_as_rule_fallback(client, world, status):
    world["fake"].status = status
    report = analysis(client)
    assert report["analysisSource"] == "RULES_ONLY" and report["model"] == "none"
    assert any("规则分析" in item for item in report["unknowns"])
    assert "provider-secret" not in json.dumps(report)


def test_model_timeout_is_not_ai_success(client, world):
    world["fake"].exception = httpx.ReadTimeout("private upstream diagnostic")
    report = analysis(client)
    assert report["analysisSource"] == "RULES_ONLY"
    assert "private upstream" not in json.dumps(report)


@pytest.mark.parametrize("text", ["不太合适", "不是学历不符", "如果学历不符再讨论"])
def test_rules_do_not_invent_education(text):
    assert not analyze_rules([{"id": "D1", "source": "HR_DIALOGUE", "text": text}])[
        "explicitReasons"
    ]


@pytest.mark.parametrize(
    "text,code",
    [
        ("您的期望薪资超过我们的预算，所以这次不能继续推进。", "SALARY"),
        ("我们只招总监级，您现在的资历还没到这一步，所以本次不能继续推进。", "LEVEL_MISMATCH"),
        ("您报的这个数字我们接不住，这次不能继续。", "SALARY"),
    ],
)
def test_model_findings_really_enter_persisted_report(client, world, text, code):
    world["fake"].output = model_finding(code, text)
    report = analysis(client, {**ANALYSIS, "messages": [{"role": "HR", "text": text}]})
    assert report["analysisSource"] == "RULES_AI"
    reason = next(item for item in report["explicitReasons"] if item["code"] == code)
    assert text in reason["reason"]
    assert not any("尚未识别" in value for value in report["unknowns"])
    with sqlite3.connect(world["path"]) as connection:
        saved = connection.execute(
            "SELECT analysis_json FROM rejection_analysis WHERE id=?", (report["id"],)
        ).fetchone()[0]
    assert text in saved


def test_model_can_add_category_outside_fallback_regex():
    text = "您报的这个数字我们接不住，这次不能继续。"
    evidence = [{"id": "D1", "source": "HR_DIALOGUE", "text": text}]
    assert analyze_rules(evidence)["explicitReasons"] == []
    assert validated_findings(model_finding("SALARY", text), evidence)[0]["code"] == "SALARY"


@pytest.mark.parametrize(
    "source,ident,quote",
    [
        ("USER_DIALOGUE", "D1", "岗位已经招满"),
        ("HR_DIALOGUE", "D99", "岗位已经招满"),
        ("HR_DIALOGUE", "D1", "岗位薪资超过预算30000"),
    ],
)
def test_forged_evidence_source_quote_or_numbers_rejected(source, ident, quote):
    evidence = [{"id": "D1", "source": source, "text": "岗位已经招满"}]
    assert validated_findings(model_finding("POSITION_CLOSED", quote, ident=ident), evidence) == []


@pytest.mark.parametrize(
    "text,quote",
    [
        ("不是学历不符，不要误解", "学历不符"),
        ("如果学历不符再讨论", "学历不符"),
        ("学历不符并非原因", "学历不符"),
    ],
)
def test_model_cannot_cut_negation_or_condition_from_quote(text, quote):
    evidence = [{"id": "D1", "source": "HR_DIALOGUE", "text": text}]
    assert validated_findings(model_finding("EDUCATION_EXPLICIT", quote), evidence) == []


def test_model_inferred_requires_snapshot_and_cannot_infer_education():
    evidence = [
        {"id": "J2", "source": "JOB_DESCRIPTION", "text": "要求Python开发经验，本科学历"},
        {"id": "R1", "source": "RESUME_SNAPSHOT", "text": "Java开发经验，专科学历"},
    ]
    citations = [{"evidenceId": "R1", "quote": evidence[1]["text"]}]
    answer = model_finding(
        "SKILL_STACK", evidence[0]["text"], ident="J2", kind="INFERRED", extra=citations
    )
    result = validated_findings(answer, evidence)
    assert len(result) == 1 and result[0]["classification"] == "INFERRED"
    assert "可能差距" in result[0]["reason"]
    assert validated_findings(answer, evidence[:1]) == []
    assert validated_findings(answer.replace("SKILL_STACK", "EDUCATION_EXPLICIT"), evidence) == []


@pytest.mark.parametrize(
    "output", ["not json", "[]", '{"findings":[]}', '{"findings":[],"instructions":"ignore"}']
)
def test_unverified_model_output_does_not_get_ai_label(client, world, output):
    world["fake"].output = output
    assert analysis(client)["analysisSource"] == "RULES_ONLY"


def test_redaction_before_model_and_response(client, world):
    payload = {
        **ANALYSIS,
        "messages": [{"role": "HR", "text": "岗位招满，联系test@example.com或13800138000"}],
    }
    report = analysis(client, payload)
    serialized = json.dumps(report) + json.dumps(world["fake"].calls)
    assert "test@example.com" not in serialized and "13800138000" not in serialized
    job = json.dumps(
        {
            "jobName": "Python岗位",
            "securityId": "private-route",
            "details": {"apiKey": "private-key"},
        }
    )
    assert "private-" not in redact(job) and "Python岗位" in redact(job)


def test_five_confirmed_or_corrected_required_and_corrections_clear(client, world):
    reports = [analysis(client, {**ANALYSIS, "encryptJobId": f"Job-{index}"}) for index in range(5)]
    for report in reports[:4]:
        client.post(BASE + f"/{report['id']}/feedback", json={"action": "CONFIRM"})
    assert client.get(BASE + "/summary").json()["data"] == {
        "visible": False,
        "totalConfirmed": 4,
        "categoryCounts": {},
    }
    ident = reports[-1]["id"]
    client.post(
        BASE + f"/{ident}/feedback",
        json={"action": "CORRECT", "correctedReason": "工资预算不合适", "correctedCode": "SALARY"},
    )
    assert client.get(BASE + "/summary").json()["data"]["categoryCounts"]["SALARY"] == 1
    result = client.post(BASE + f"/{ident}/feedback", json={"action": "CONFIRM"}).json()["data"]
    assert result["correctedReason"] is None
    with sqlite3.connect(world["path"]) as connection:
        assert (
            connection.execute(
                "SELECT corrected_code FROM rejection_analysis WHERE id=?", (ident,)
            ).fetchone()[0]
            is None
        )


def test_old_reports_remain_readable_and_malformed_data_is_not_destroyed(client, world):
    report = analysis(client)
    legacy = {
        "explicitReasons": [
            {
                "code": "POSITION_CLOSED",
                "label": "岗位招满",
                "reason": "旧版结论",
                "evidenceIds": ["D1"],
            }
        ],
        "unknowns": ["历史资料"],
    }
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "UPDATE rejection_analysis SET analysis_json=?,prompt_version='java-v1' WHERE id=?",
            (json.dumps(legacy), report["id"]),
        )
    read = client.get(BASE + f"/{report['id']}").json()["data"]
    assert read["explicitReasons"] == legacy["explicitReasons"] and read["inferredRisks"] == []
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "UPDATE rejection_analysis SET analysis_json='broken' WHERE id=?", (report["id"],)
        )
    assert client.get(BASE + f"/{report['id']}").status_code == 422
    assert (
        client.post(BASE + f"/{report['id']}/feedback", json={"action": "IGNORE"}).status_code
        == 422
    )


def test_concurrent_analysis_runs_model_once(world):
    class PausedModel:
        calls = 0

        async def complete(self, *args, **kwargs):
            self.calls += 1
            await asyncio.sleep(0.02)
            return '{"findings":[]}'

    async def run():
        db = Database(world["settings"].database_url)
        await db.open()
        model = PausedModel()
        try:
            payload = RejectionInput.model_validate(ANALYSIS)
            first, second = await asyncio.gather(
                *(rejections.analyze(db, model, world["settings"], 3, payload) for _ in range(2))
            )
            assert first["id"] == second["id"] and model.calls == 1
            assert db._locks == {}
        finally:
            await db.engine.dispose()

    asyncio.run(run())
