import pytest

from job_helper_api.application_validity import (
    classify_application,
    role_mismatch,
    salary_fit,
    salary_within_target,
)

PREFERENCE = {
    "sr": "13-18",
    "employmentExcludeE": True,
    "employmentExcludeKeywords": ["外包", "劳务派遣", "驻场", "外派"],
}


@pytest.mark.parametrize(
    ("title", "jd", "salary", "primary", "extra"),
    [
        ("测试开发工程师", "自动化测试与功能测试", "10-15K", "ROLE_TESTING", None),
        (
            "策略与交易系统工程师（Rust，校招/初级）",
            "使用 Rust 开发核心交易代码",
            "12-20K",
            "ROLE_TRADING_SYSTEM",
            None,
        ),
        ("测试工程师", "JMeter、Postman 接口测试", "10-13K", "ROLE_TESTING", None),
        (
            "数据分析与处理工程师",
            "使用 C++、OpenCV、MATLAB 做图像处理和模型推理",
            "10-15K",
            "ROLE_DATA_ANALYSIS",
            None,
        ),
        (
            "数据开发",
            "Hive、Spark、Flink、Kafka 和数仓建模",
            "15-20K",
            "ROLE_DATA_ENGINEERING",
            None,
        ),
        (
            "大数据工程师（驻场宁波）",
            "客户现场交付",
            "10-14K",
            "ROLE_DATA_ENGINEERING",
            "EMPLOYMENT_EXCLUSION",
        ),
        ("自动化测试工程师（HZ）", "自动化测试", "10-12K", "ROLE_TESTING", None),
    ],
)
def test_user_confirmed_invalid_application_examples_are_classified(
    title, jd, salary, primary, extra
):
    result = classify_application(
        {"jobTitle": title, "jdText": jd, "salaryText": salary}, PREFERENCE
    )
    codes = [item["code"] for item in result["evidence"]["reasons"]]
    assert result["validity"] == "INVALID"
    assert result["primaryReasonCode"] == primary
    if extra:
        assert extra in codes
    assert result["evidence"]["experienceYearsUsedAsHardGate"] is False


def test_experience_years_remain_advisory_for_a_valid_ai_application_role():
    result = classify_application(
        {
            "jobTitle": "AI 应用全栈工程师",
            "salaryText": "15-18K",
            "jdText": "要求3-5年经验，使用 Python、FastAPI、Vue 开发 Agent 应用",
            "preMatchResult": {"decisionStatus": "MATCH", "filter": False},
        },
        PREFERENCE,
    )
    assert result["validity"] == "VALID"
    assert result["primaryReasonCode"] is None
    assert result["evidence"]["reasons"] == []
    assert result["evidence"]["experienceYearsUsedAsHardGate"] is False


def test_ai_prematch_cannot_turn_experience_wording_into_a_hard_invalid_reason():
    result = classify_application(
        {
            "jobTitle": "Python 后端开发",
            "salaryText": "13-18K",
            "jdText": "要求3-5年经验",
            "preMatchResult": {
                "decisionStatus": "REJECT",
                "filter": True,
                "engine": "AI",
                "reason": "工作年限不足",
            },
        },
        PREFERENCE,
    )
    assert result["validity"] == "UNKNOWN"
    assert result["evidence"]["reasons"] == []


def test_salary_policy_has_tolerance_and_a_high_match_stretch_band():
    assert salary_within_target("13-18", "15-18K") is True
    assert salary_fit("13-15", "13-18K") == "TOLERATED"
    assert salary_fit("13-18", "15-30K·13薪") == "STRETCH"
    assert salary_within_target("13-18", "15-30K·13薪") is True
    assert salary_fit("13-18", "25-50K") == "OUTSIDE"
    assert salary_within_target("13-18", "面议") is None


def test_salary_stretch_is_an_advisory_not_an_invalid_application():
    result = classify_application(
        {
            "jobTitle": "AI 应用全栈工程师",
            "salaryText": "15-30K·13薪",
            "jdText": "Python、FastAPI、Vue 和 Agent 应用开发",
        },
        PREFERENCE,
    )
    assert result["validity"] == "UNKNOWN"
    assert result["primaryReasonCode"] is None
    assert result["evidence"]["reasons"] == []
    assert result["evidence"]["advisories"][0]["code"] == "SALARY_STRETCH"
    assert result["evidence"]["salaryFit"] == "STRETCH"


def test_user_confirmed_data_analysis_title_stays_invalid_even_when_only_partial_metadata_exists():
    assert role_mismatch("数据分析与处理工程师", "Python 数据报表")["code"] == "ROLE_DATA_ANALYSIS"
    assert (
        role_mismatch("数据分析与处理工程师", "OpenCV 图像处理和目标检测")["code"]
        == "ROLE_DATA_ANALYSIS"
    )
