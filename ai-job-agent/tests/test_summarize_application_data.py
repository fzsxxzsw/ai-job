from __future__ import annotations

import importlib.util
from pathlib import Path


SCRIPT_PATH = Path(__file__).parents[1] / "scripts" / "summarize_application_data.py"
SPEC = importlib.util.spec_from_file_location("summarize_application_data", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def message(role: str, text: str, order_at: int, message_id: str) -> dict:
    return {
        "encrypt_job_id": "job-1",
        "message_id": message_id,
        "role": role,
        "author_kind": role,
        "text": text,
        "sent_at": order_at,
        "observed_at": order_at,
        "order_at": order_at,
        "delivery_state": "OBSERVED",
    }


def job(applied_at: int = 1_000) -> dict:
    return {
        "applied_at": applied_at,
        "job_base_info": '{"jobName":"AI Agent工程师","jobExperience":"3-5年"}',
        "job_ext_info": '{"postDescription":"要求 Python、LangGraph、RAG 和 Kubernetes"}',
        "job_title": "AI Agent工程师",
    }


def test_clean_messages_deduplicates_and_labels_platform_noise() -> None:
    rows = [
        message("HR", "对方已查看了您的附件简历", 2_000, "m1"),
        message("HR", "对方已查看了您的附件简历", 2_000, "m1"),
        message("HR", "你与该职位竞争者PK情况", 2_100, "m2"),
        message("USER", "您好，这是我的简历", 2_200, "m3"),
    ]

    cleaned = MODULE.clean_messages(rows)

    assert len(cleaned) == 3
    assert cleaned[0]["noise_type"] == "READ_RECEIPT"
    assert cleaned[0]["is_read_evidence"] is True
    assert cleaned[1]["noise_type"] == "COMPETITION_CARD"
    assert cleaned[2]["is_meaningful"] is True


def test_explicit_rejection_wins_over_generic_reply() -> None:
    cleaned = MODULE.clean_messages(
        [message("HR", "[祈祷] 不好意思，不太合适哦", 2_000, "m1")]
    )

    result = MODULE.classify_job(
        job(), cleaned, {}, as_of_ms=10_000_000, mature_hours=72
    )

    assert result["status"] == "EXPLICIT_REJECTION"
    assert result["rejection_evidence"] == ["[祈祷] 不好意思,不太合适哦"]


def test_conditional_interview_is_not_treated_as_real_invitation() -> None:
    cleaned = MODULE.clean_messages(
        [
            message(
                "HR",
                "好的，这边发部门看下，如果简历通过，会1天内通知面试哈",
                2_000,
                "m1",
            )
        ]
    )

    result = MODULE.classify_job(
        job(), cleaned, {}, as_of_ms=10_000_000, mature_hours=72
    )

    assert result["status"] == "HR_REPLIED_NO_INTERVIEW"
    assert result["interview_evidence"] == []
    assert cleaned[0]["is_conditional_interview"] is True


def test_read_without_reply_uses_user_policy_after_threshold() -> None:
    cleaned = MODULE.clean_messages(
        [
            message("USER", "您好，这是我的简历", 2_000, "m1"),
            message("HR", "对方已查看了您的附件简历", 3_000, "m2"),
        ]
    )

    result = MODULE.classify_job(
        job(),
        cleaned,
        {},
        as_of_ms=3_000 + 73 * 3_600_000,
        mature_hours=72,
    )

    assert result["status"] == "READ_NO_REPLY"
    assert result["read_state"] == "READ"
    assert result["waiting_on"] == "HR"


def test_unverified_stale_application_is_not_called_read() -> None:
    result = MODULE.classify_job(
        job(),
        [],
        {},
        as_of_ms=1_000 + 73 * 3_600_000,
        mature_hours=72,
    )

    assert result["status"] == "STALE_NO_REPLY_UNVERIFIED_READ"
    assert result["read_state"] == "UNKNOWN"


def test_resume_profile_and_mismatch_use_historical_resume() -> None:
    resume = """
    工作经历
    甲公司｜Python工程师 2025.09–2026.06
    乙公司｜AI应用工程师 2026.07–2026.09
    项目经历
    使用 Python、FastAPI、LangGraph、Vue 和 Docker 开发智能体系统。
    """
    profile = MODULE.resume_profile(resume)

    mismatch = MODULE.mismatch_analysis(job(), profile, resume)

    assert profile["experience_months"] == 13
    assert profile["short_stints_under_6_months"] == 1
    assert "Python" in profile["skills"]
    assert "LangGraph" in profile["skills"]
    assert mismatch["required_experience_months"] == 36
    assert "EXPERIENCE_GAP" in mismatch["reason_flags"]
    assert mismatch["missing_skills"] == ["Kubernetes", "RAG"]


def test_mask_pii_masks_phone_and_email() -> None:
    masked = MODULE.mask_pii("联系 17704998101 或 test@example.com")

    assert "17704998101" not in masked
    assert "test@example.com" not in masked
    assert masked == "联系 [PHONE] 或 [EMAIL]"


def test_conversation_without_snapshot_is_preserved_with_quality_flags() -> None:
    data = {
        "snapshots": [],
        "messages": [message("HR", "不好意思，不太合适哦", 2_000, "m1")],
        "outcomes": [],
        "user_resumes": [],
        "career_resumes": [],
    }

    jobs = MODULE.build_job_records(
        data, {}, as_of_ms=3_000, mature_hours=72
    )

    assert len(jobs) == 1
    assert jobs[0]["record_scope"] == "CONVERSATION_ONLY"
    assert jobs[0]["classification"]["status"] == "EXPLICIT_REJECTION"
    assert jobs[0]["data_quality_flags"] == [
        "NO_APPLICATION_SNAPSHOT",
        "NO_HISTORICAL_RESUME",
    ]


def test_snapshot_resume_sources_are_aggregated_instead_of_repeated() -> None:
    content = "工作经历\n甲公司 2025.09-2026.06\n项目经历\nPython"
    data = {
        "snapshots": [
            {"id": 1, "applied_at": 1_000, "resume_content": content},
            {"id": 2, "applied_at": 2_000, "resume_content": content},
        ],
        "messages": [],
        "outcomes": [],
        "user_resumes": [],
        "career_resumes": [],
    }

    versions, _ = MODULE.build_resume_versions(data, include_pii=False)

    assert len(versions) == 1
    assert versions[0]["application_count"] == 2
    assert len(versions[0]["sources"]) == 1
    assert versions[0]["sources"][0]["source"] == "job_application_snapshot"
