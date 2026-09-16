"""Deterministic application-validity classification for storage and analytics.

Outcome is deliberately orthogonal to validity: an invalid application may still
be read, rejected, interviewed, or offered. Experience-year wording is retained
as job metadata but is never used by this classifier as a hard gate.
"""

import re
import unicodedata
from typing import Any

from .database import dumps, loads
from .employment_exclusions import match_employment_exclusion

CLASSIFIER_VERSION = "application-validity-v2"
SALARY_TOLERANCE_K = 3.0

NON_TECHNICAL_ROLE = re.compile(
    r"主播|直播带货|美妆|调解|催收|销售|客服|招聘|人事|行政|文员|商务拓展|商务推广|商务bd|"
    r"渠道拓展|课程顾问|电话邀约|市场开发|业务开发|客户开发|产品经理|产品运营|内容运营|"
    r"用户运营|直播运营|数据标注|模型训练",
    re.I,
)
APPLICATION_ROLE_OVERRIDE = re.compile(r"ai应用|人工智能应用|aigc|agent|智能体|全栈", re.I)
PURE_FRONTEND_ROLE = re.compile(r"前端|web前端", re.I)
PURE_JAVA_ROLE = re.compile(
    r"java.*(?:后端|开发|研发|工程师|程序员)|(?:后端|开发|研发|工程师|程序员).*java", re.I
)
TRAINING_ALGORITHM_ROLE = re.compile(r"算法训练|训练算法|模型训练", re.I)
TESTING_ROLE = re.compile(
    r"测试开发|自动化测试|软件测试|测试工程师|测试平台|质量保障|qa工程师", re.I
)
TRADING_SYSTEM_ROLE = re.compile(r"交易系统|量化交易|量化策略|策略与交易|交易策略", re.I)
DATA_ENGINEERING_ROLE = re.compile(r"大数据|数据开发|数据仓库|数仓|etl工程师|数据平台开发", re.I)
DATA_ANALYSIS_ROLE = re.compile(r"数据分析与处理工程师", re.I)
CV_IMAGE_ROLE = re.compile(r"图像处理|计算机视觉|视觉算法|机器视觉|目标检测", re.I)
CV_IMAGE_EVIDENCE = re.compile(r"opencv|matlab|图像处理|图像生成|目标检测|模型加速|模型推理", re.I)
DATA_ANALYSIS_TITLE = re.compile(r"数据分析|数据处理", re.I)


def _object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    parsed = loads(value, {}) if isinstance(value, str) else {}
    return parsed if isinstance(parsed, dict) else {}


def _normalized(value: Any) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or ""))).lower()


def role_mismatch(job_title: Any, jd_text: Any = "") -> dict[str, str] | None:
    """Return an explicit off-target role family; never inspect experience years."""
    title = _normalized(job_title)
    jd = unicodedata.normalize("NFKC", str(jd_text or ""))
    if not title:
        return None
    checks = (
        (TESTING_ROLE, "ROLE_TESTING", "岗位属于测试或质量保障方向"),
        (TRADING_SYSTEM_ROLE, "ROLE_TRADING_SYSTEM", "岗位属于交易系统或量化策略方向"),
        (DATA_ENGINEERING_ROLE, "ROLE_DATA_ENGINEERING", "岗位属于大数据、数仓或数据开发方向"),
        (DATA_ANALYSIS_ROLE, "ROLE_DATA_ANALYSIS", "岗位属于数据分析与处理方向"),
        (CV_IMAGE_ROLE, "ROLE_CV_IMAGE", "岗位属于计算机视觉或图像处理方向"),
        (NON_TECHNICAL_ROLE, "ROLE_NON_TECHNICAL", "岗位名称明确属于非技术或非研发方向"),
    )
    for pattern, code, reason in checks:
        if pattern.search(title):
            return {"code": code, "reason": reason, "field": "jobTitle"}
    if DATA_ANALYSIS_TITLE.search(title) and CV_IMAGE_EVIDENCE.search(jd):
        return {
            "code": "ROLE_CV_IMAGE",
            "reason": "岗位正文以图像处理、视觉算法或模型推理为核心",
            "field": "jdText",
        }
    if APPLICATION_ROLE_OVERRIDE.search(title):
        return None
    if PURE_FRONTEND_ROLE.search(title):
        return {
            "code": "ROLE_PURE_FRONTEND",
            "reason": "岗位名称明确为纯前端方向，不属于当前投递方向",
            "field": "jobTitle",
        }
    if PURE_JAVA_ROLE.search(title):
        return {
            "code": "ROLE_PURE_JAVA",
            "reason": "岗位名称明确为纯 Java 方向，不属于当前投递方向",
            "field": "jobTitle",
        }
    if TRAINING_ALGORITHM_ROLE.search(title):
        return {
            "code": "ROLE_TRAINING_ALGORITHM",
            "reason": "岗位名称明确为算法训练方向，不属于当前投递方向",
            "field": "jobTitle",
        }
    return None


def salary_range(value: Any) -> tuple[float, float] | None:
    match = re.search(r"(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?", str(value or ""))
    if not match:
        return None
    start = float(match.group(1))
    end = float(match.group(2) or match.group(1))
    return (start, end) if start <= end else (end, start)


def salary_within_target(configured: Any, offered: Any) -> bool | None:
    decision = salary_fit(configured, offered)
    if decision in {"UNRESTRICTED", "UNKNOWN"}:
        return None
    return decision != "OUTSIDE"


def salary_fit(configured: Any, offered: Any) -> str:
    target = salary_range(configured)
    if not target:
        return "UNRESTRICTED"
    actual = salary_range(offered)
    if not actual:
        return "UNKNOWN"
    lower_boundary = target[0] - SALARY_TOLERANCE_K
    upper_boundary = target[1] + SALARY_TOLERANCE_K
    if actual[1] < lower_boundary or actual[0] > upper_boundary:
        return "OUTSIDE"
    if actual[1] > upper_boundary:
        return "STRETCH"
    if target[0] <= actual[0] and actual[1] <= target[1]:
        return "PREFERRED"
    return "TOLERATED"


def _preference(snapshot: dict[str, Any], current: Any) -> dict[str, Any]:
    current_value = _object(current)
    captured = _object(snapshot.get("capturedPreference"))
    return {**current_value, **captured} if captured else current_value


def classify_application(snapshot: Any, current_preference: Any = None) -> dict[str, Any]:
    """Classify stored evidence without inventing resume facts or inferring seniority."""
    value = snapshot if isinstance(snapshot, dict) else {}
    base, ext = _object(value.get("jobBaseInfo")), _object(value.get("jobExtInfo"))
    title = value.get("jobTitle") or base.get("jobName") or base.get("jobTitle") or ""
    salary = value.get("salaryText") or base.get("salaryDesc") or base.get("salary") or ""
    location = value.get("locationText") or ext.get("address") or ""
    jd = (
        value.get("jdText")
        or ext.get("postDescription")
        or ext.get("jobDescription")
        or ext.get("description")
        or ""
    )
    preference = _preference(value, current_preference)
    reasons: list[dict[str, Any]] = []
    advisories: list[dict[str, Any]] = []

    if issue := role_mismatch(title, jd):
        reasons.append({**issue, "observed": str(title)[:500]})

    exclusion = match_employment_exclusion(preference, base, ext, title, jd, location)
    if exclusion:
        reasons.append(
            {
                "code": "EMPLOYMENT_EXCLUSION",
                "reason": f"命中已配置的用工形态或工作条件排除词：{exclusion}",
                "field": "jobMetadata",
                "observed": str(exclusion)[:200],
            }
        )

    configured_salary = str(preference.get("sr") or "").strip()
    salary_decision = salary_fit(configured_salary, salary)
    if salary_decision == "OUTSIDE":
        reasons.append(
            {
                "code": "SALARY_OUTSIDE_TARGET",
                "reason": "岗位薪资与当前配置的差距超过 3K 容忍带",
                "field": "salaryText",
                "observed": str(salary)[:200],
                "configuredRange": configured_salary[:100],
            }
        )
    elif salary_decision == "STRETCH":
        advisories.append(
            {
                "code": "SALARY_STRETCH",
                "reason": "岗位薪资上限超过 3K 容忍带，仅在简历与 JD 高匹配时例外考虑",
                "field": "salaryText",
                "observed": str(salary)[:200],
                "configuredRange": configured_salary[:100],
            }
        )

    pre_match = value.get("preMatchResult")
    pre_match = pre_match if isinstance(pre_match, dict) else _object(pre_match)
    engine = str(pre_match.get("engine") or "").upper()
    if (
        pre_match.get("filter") is True
        and engine in {"LOCAL_ROLE_GATE", "LOCAL_EXCLUSIONS"}
        and not reasons
    ):
        reasons.append(
            {
                "code": "PREMATCH_REJECTED",
                "reason": str(pre_match.get("reason") or "投递前硬规则判定不符合")[:1000],
                "field": "preMatchResult",
                "observed": engine,
            }
        )

    if reasons:
        validity = "INVALID"
    elif str(pre_match.get("decisionStatus") or "").upper() == "MATCH":
        validity = "VALID"
    else:
        validity = "UNKNOWN"
    return {
        "validity": validity,
        "primaryReasonCode": reasons[0]["code"] if reasons else None,
        "evidence": {
            "classifierVersion": CLASSIFIER_VERSION,
            "reasons": reasons,
            "advisories": advisories,
            "salaryFit": salary_decision,
            "experienceYearsUsedAsHardGate": False,
        },
    }


def validity_columns(snapshot, current_preference, *, observed_at: int, source: str) -> dict:
    """Return the canonical storage projection for one classification run."""
    result = classify_application(snapshot, current_preference)
    evidence = {
        **result["evidence"],
        "source": source,
        "evaluatedAt": observed_at,
    }
    return {
        "application_validity": result["validity"],
        "validity_reason_code": result["primaryReasonCode"],
        "validity_evidence_json": dumps(evidence),
        "validity_updated_at": observed_at,
    }
