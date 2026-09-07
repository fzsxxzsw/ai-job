"""Conservative fallback and a stable report taxonomy; no current-resume backfill."""

import re
from typing import TypedDict

from .context import is_assertive_context
from .evidence import Evidence

PROMPT_VERSION = "rejection-python-v2"
TAXONOMY_VERSION = "rejection-taxonomy-v1"
LABELS = {
    "POSITION_CLOSED": "职位已关闭或招满",
    "EDUCATION_EXPLICIT": "学历或院校硬条件",
    "LEVEL_MISMATCH": "经验或岗位级别不匹配",
    "INDUSTRY_DOMAIN": "行业经验要求",
    "MANAGEMENT_REQUIRED": "管理经验要求",
    "SKILL_STACK": "技能要求",
    "SALARY": "薪资预算不匹配",
    "LOCATION": "工作地点不匹配",
    "AVAILABILITY": "到岗时间不匹配",
}
ALLOWED_CODES = set(LABELS) | {"GENERIC_REJECTION", "UNKNOWN", "USER_CORRECTION"}
PATTERNS = {
    "POSITION_CLOSED": r"(?:职位|岗位|招聘|HC|名额).{0,12}(?:关闭|暂停|取消|冻结|已满|招满)|(?:已经|目前|暂时)?(?:已)?招满了?",
    "EDUCATION_EXPLICIT": r"(?:学历|本科|硕士|研究生|博士|学校|院校).{0,12}(?:不符|不合适|不匹配|达不到|未达到)|(?:不符|不合适|不匹配|未达到).{0,12}(?:学历|学校|院校)",
    "LEVEL_MISMATCH": r"(?:经验|年限|级别|资历).{0,12}(?:不符|不合适|不匹配|不足|未达到|还没到)|(?:不符|不合适|不匹配|不足|未达到).{0,12}(?:经验|年限|级别|资历)",
    "INDUSTRY_DOMAIN": r"(?:必须|需要|要求|至少|具备)[^。；;\n]{0,28}(?:TMS|运输管理系统|物流|供应链)|(?:TMS|运输管理系统|物流|供应链)[^。；;\n]{0,28}(?:必须|需要|要求|不符|不匹配|不足|没有)",
    "SALARY": r"(?:薪资|薪酬|薪水|工资|期望).{0,16}(?:超出|超过|高于|太高|偏高|不匹配|不符).{0,12}(?:预算|薪资|范围)?|(?:预算|薪资).{0,12}(?:达不到|无法满足|不能满足)",
}
NO_EXPLICIT = "现有资料中尚未识别出可核验的具体拒绝原因，请核对HR原话"
NO_INFERRED = "现有岗位与简历证据不足以定位主要差距"


class Finding(TypedDict):
    code: str
    label: str
    classification: str
    reason: str
    evidenceIds: list[str]


class Report(TypedDict):
    explicitReasons: list[Finding]
    inferredRisks: list[Finding]
    unknowns: list[str]
    suggestions: list[str]
    evidence: list[Evidence]


def finding(code: str, classification: str, reason: str, ids: list[str]) -> Finding:
    return {
        "code": code,
        "label": LABELS[code],
        "classification": classification,
        "reason": reason,
        "evidenceIds": ids,
    }


def affirmed(pattern: str, value: str) -> bool:
    for match in re.finditer(pattern, value, re.I):
        before = re.split(r"[，。；;\n]", value[max(0, match.start() - 24) : match.start()])[-1]
        after = value[match.end() : match.end() + 14]
        local_clause = before + match.group() + re.split(r"[，,。；;\n]", after)[0]
        if re.search(
            r"(?:没有|并未|未曾|不曾|并不|不算|不至于)\s*(?:超过|超出|高于|偏高|太高|不足|不符|不匹配|缺少|缺乏|关闭|招满)",
            local_clause,
        ):
            continue
        if re.search(r"不是|并非|并不是|不因|无关|排除|否认", before + match.group()):
            continue
        if re.search(r"(?:如果|假如|倘若|要是|若)[^，。；;\n]{0,16}$", before):
            continue
        if re.search(r"^[^。；;\n]{0,10}(?:不是原因|并非原因|无关|已排除)", after):
            continue
        return True
    return False


def max_years(value: str) -> int:
    patterns = (
        r"(?<!\d)(\d{1,2})\s*年(?:以上|及以上)?[^。；;\n]{0,16}(?:工作|开发|相关)?经验",
        r"(?:工作|开发|相关)?经验[^。；;\n]{0,12}(?:至少|要求|约|近)?\s*(\d{1,2})\s*年",
    )
    years = [int(match) for pattern in patterns for match in re.findall(pattern, value)]
    return max((number for number in years if number <= 30), default=-1)


def analyze_rules(evidence: list[Evidence]) -> Report:
    explicit: dict[str, Finding] = {}
    inferred: dict[str, Finding] = {}
    for item in evidence:
        if item["source"] != "HR_DIALOGUE" or not is_assertive_context(item["text"]):
            continue
        for code, pattern in PATTERNS.items():
            # Reasons must stay within their clause; e.g. "学历合适，经验不符"
            # does not make education a rejection reason.
            clauses = re.split(r"[，,。；;\n]", item["text"])
            if any(affirmed(pattern, clause) for clause in clauses):
                explicit.setdefault(
                    code, finding(code, "EXPLICIT", "HR原话明确提及：" + LABELS[code], [item["id"]])
                )
    jd = [item for item in evidence if item["source"] in ("JOB_BASE", "JOB_DESCRIPTION")]
    resume = next((item for item in evidence if item["source"] == "RESUME_SNAPSHOT"), None)
    truncated = [item for item in evidence if item.get("truncated")]
    if jd and resume and not truncated:
        most = max(jd, key=lambda item: max_years(item["text"]))
        years, actual = max_years(most["text"]), max_years(resume["text"])
        if years >= 5 and actual >= 0 and years - actual >= 3:
            inferred["LEVEL_MISMATCH"] = finding(
                "LEVEL_MISMATCH",
                "INFERRED",
                f"岗位文字出现约{years}年经验要求，简历文字出现约{actual}年经验；需人工核对，并非已证实的拒绝原因",
                [most["id"], resume["id"]],
            )
        for item in jd:
            if affirmed(PATTERNS["INDUSTRY_DOMAIN"], item["text"]) and not re.search(
                r"TMS|运输管理系统|物流|供应链", resume["text"], re.I
            ):
                inferred["INDUSTRY_DOMAIN"] = finding(
                    "INDUSTRY_DOMAIN",
                    "INFERRED",
                    "岗位要求相关行业经验，投递时简历快照未找到对应证据；不代表实际没有经验",
                    [item["id"], resume["id"]],
                )
            if affirmed(r"管理经验|带领团队|团队管理", item["text"]) and not re.search(
                r"管理|带队|带领团队", resume["text"]
            ):
                inferred["MANAGEMENT_REQUIRED"] = finding(
                    "MANAGEMENT_REQUIRED",
                    "INFERRED",
                    "岗位要求管理或带队经验，简历快照未找到对应证据；需人工核对",
                    [item["id"], resume["id"]],
                )
    unknowns = ["当前页对话可能不完整；推断不代表招聘方真实动机"]
    source_labels = {
        "JOB_BASE": "岗位基本资料",
        "JOB_DESCRIPTION": "岗位描述",
        "RESUME_SNAPSHOT": "投递时简历",
    }
    for item in truncated:
        label = source_labels.get(item["source"], "证据")
        unknowns.append(
            f"{label}超出处理上限，仅截取前{len(item['text'])}字，资料不完整；本次不进行岗位与简历差距推断"
        )
    if not explicit:
        unknowns.append(NO_EXPLICIT)
    if not jd or not resume:
        unknowns.append("缺少投递时的岗位或简历快照，仅分析HR明确表达，不补造历史资料")
    if not inferred:
        unknowns.append(NO_INFERRED)
    suggestions = ["不因本次拒绝修改简历事实；调整投递条件前请人工确认"]
    if "POSITION_CLOSED" in explicit:
        suggestions.append("岗位关闭或招满属于不可控因素，不要据此否定个人能力")
    return {
        "explicitReasons": list(explicit.values()),
        "inferredRisks": list(inferred.values()),
        "unknowns": unknowns,
        "suggestions": suggestions,
        "evidence": evidence,
    }
