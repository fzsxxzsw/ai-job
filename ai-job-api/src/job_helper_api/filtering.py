"""Personal filtering parity with JobFilterService and LocalResumeJobMatcher V2.

Default resume/JD scoring is deterministic and advisory. Only explicit free-text
conditions use the configured model; score thresholds cannot override hard rules.
"""

import json
import math
import re
import unicodedata
from typing import Any

from .config import Settings
from .contracts import FilterInput, FilterOutput
from .database import Database
from .errors import ApiError
from .model import ModelClient, effective_config, structured_object
from .prompts import FILTER

ALIASES = {
    "Java": ("java",),
    "Spring": ("spring boot", "springboot", "spring cloud", "spring"),
    "Python": ("python",),
    "Django/FastAPI/Flask": ("django", "fastapi", "flask"),
    "JavaScript/TypeScript": ("javascript", "typescript", "js", "ts"),
    "Vue/Nuxt": ("vue.js", "vuejs", "vue", "nuxt"),
    "React": ("react.js", "reactjs", "react"),
    "Node.js": ("node.js", "nodejs"),
    "前端开发": ("前端开发", "前端工程师"),
    "后端开发": ("后端开发", "后端工程师"),
    "全栈开发": ("全栈开发", "全栈工程师"),
    "AI/大模型": ("人工智能", "aigc", "大模型", "llm", "ai"),
    "Agent/智能体": ("智能体", "ai agent", "agent"),
    "RAG": ("rag", "检索增强生成"),
    "LangChain/LangGraph": ("langchain", "langgraph"),
    "MySQL": ("mysql",),
    "PostgreSQL": ("postgresql", "postgres"),
    "Redis": ("redis",),
    "MongoDB": ("mongodb", "mongo"),
    "Elasticsearch": ("elasticsearch", "elastic search", "es"),
    "Docker": ("docker",),
    "Kubernetes": ("kubernetes", "k8s"),
    "Linux": ("linux",),
    "Git": ("git",),
    "微服务": ("微服务", "microservice"),
    "消息队列": ("kafka", "rabbitmq", "rocketmq", "消息队列"),
    "自动化测试": ("selenium", "playwright", "puppeteer", "appium", "drissionpage", "自动化测试"),
    "Go": ("golang", "go语言"),
    "C++": ("c++", "cpp"),
    "C#/.NET": ("c#", ".net", "dotnet"),
    "PHP": ("php",),
}
SPECIFICITY = {
    "前端开发": 0.55,
    "后端开发": 0.55,
    "全栈开发": 0.65,
    "AI/大模型": 0.65,
    "Agent/智能体": 0.8,
    "Git": 0.5,
    "Linux": 0.7,
}
REQUIRED = re.compile(r"必须|必备|硬性|要求|至少|精通|熟练|掌握|及以上|以上经验", re.I)
PREFERRED = re.compile(r"优先|加分|最好|preferred|nice[- ]?to[- ]?have", re.I)


def parse_object(value: str) -> dict[str, Any]:
    try:
        result = json.loads(value)
        return result if isinstance(result, dict) else {}
    except ValueError:
        return {}


def skills(text: str) -> set[str]:
    normalized = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text).lower()).strip()
    result: set[str] = set()
    for name, aliases in ALIASES.items():
        for alias in aliases:
            found = (
                re.search(r"(?<![a-z0-9])" + re.escape(alias) + r"(?![a-z0-9])", normalized)
                if re.fullmatch(r"[a-z0-9+#. ]+", alias)
                else alias in normalized
            )
            if found:
                result.add(name)
                break
    return result


def local_match(payload: FilterInput, resume: str) -> dict[str, Any]:
    base, extra = parse_object(payload.jobBaseInfo), parse_object(payload.jobExtInfo)
    expected: dict[str, float] = {}

    def merge(text: Any, weight: float) -> None:
        for skill in skills(str(text or "")):
            expected[skill] = max(expected.get(skill, 0), weight)

    merge(base.get("jobName"), 2)
    for field, weight in (("skills", 3), ("jobLabels", 2)):
        values = base.get(field)
        if isinstance(values, list):
            for value in values:
                merge(value, weight)
    for line in re.split(r"[\n。；;]", str(extra.get("postDescription") or "")):
        merge(line, 0.6 if PREFERRED.search(line) else 2.5 if REQUIRED.search(line) else 1)
    owned = skills(resume)
    weights = {name: value * SPECIFICITY.get(name, 1) for name, value in expected.items()}
    ordered = sorted(weights, key=lambda name: (-weights[name], name))
    matched, gaps = (
        [name for name in ordered if name in owned],
        [name for name in ordered if name not in owned],
    )
    skill_score = (
        math.floor(100 * sum(weights[name] for name in matched) / sum(weights.values()) + 0.5)
        if weights
        else 0
    )
    title_score = (
        100
        if (payload.titleRuleStatus or "").upper() == "PASS" and payload.titleMatchedKeywords
        else None
    )
    score = (
        math.floor(35 + skill_score * 0.65 + 0.5)
        if title_score is not None and expected
        else title_score
        if title_score is not None
        else skill_score
    )
    evidence_count = len(expected) + int(title_score is not None)
    confidence = "HIGH" if evidence_count >= 4 else "MEDIUM" if evidence_count >= 2 else "LOW"
    title_reason = "标题规则已验证" if title_score is not None else "未加入标题偏好分"
    reason = (
        f"{title_reason}；技能{skill_score}分（识别{len(expected)}项，命中{len(matched)}项，待核实{len(gaps)}项）；"
        f"综合{score}分，置信度{confidence}。分数仅供排序，不作为跳过依据，无需调用大模型"
    )
    return {
        "decisionStatus": "MATCH",
        "filter": False,
        "score": score,
        "titleScore": title_score,
        "skillScore": skill_score,
        "confidence": confidence,
        "evidenceCount": evidence_count,
        "matchedStrengths": matched[:8],
        "gaps": gaps[:8],
        "engine": "LOCAL_RULES_V2",
        "reason": reason,
    }


def academic_mismatch(payload: FilterInput, education: str) -> str | None:
    # An explicitly configured fact replaces the old per-user hard-coded degree.
    if education != "全日制本科":
        return None
    base, extra = parse_object(payload.jobBaseInfo), parse_object(payload.jobExtInfo)
    advanced = r"硕士|研究生|博士"
    if re.search(advanced, str(base.get("jobDegree") or "")):
        return "JD明确要求硕士/研究生及以上学历；当前学历事实为全日制本科"
    for raw in re.split(r"[\n。；;]", str(extra.get("postDescription") or payload.jobExtInfo)):
        line = re.sub(r"\s+", "", raw)
        if re.search(r"优先|加分|不限|不要求", line):
            continue
        mandatory = re.search(r"必须|要求|仅限|第一学历|及以上|以上学历", line)
        if re.search(advanced, line) and mandatory:
            return "JD明确要求硕士/研究生及以上学历；当前学历事实为全日制本科"
        if re.search(r"985|211", line) and (
            mandatory or re.search(r"(985|211).*(本科|院校|高校|毕业)", line)
        ):
            return "JD明确把985/211院校背景作为硬性要求；当前简历未声明该背景"
    return None


async def filter_job(
    db: Database, model: ModelClient, settings: Settings, uid: int, payload: FilterInput
) -> dict[str, Any]:
    resume_text = ""
    if payload.resumeMatchEnabled:
        resume = await db.resume(uid)
        if not resume or not str(resume.get("resume_content") or "").strip():
            return {
                "decisionStatus": "UNKNOWN",
                "filter": True,
                "reason": "未导入简历或简历解析内容为空，请先重新导入简历",
            }
        resume_text = str(resume["resume_content"])
        if mismatch := academic_mismatch(payload, settings.confirmed_education):
            return {"decisionStatus": "REJECT", "filter": True, "score": 0, "reason": mismatch}
        if not payload.prompt:
            return local_match(payload, resume_text)

    config = effective_config(settings, await db.ai_config(uid))
    system = FILTER
    question = (
        "用户筛选条件：\n"
        + payload.prompt
        + "\n岗位基本信息：\n"
        + payload.jobBaseInfo
        + "\n岗位扩展信息：\n"
        + payload.jobExtInfo
    )
    if payload.resumeMatchEnabled:
        system += "\n另外返回score(0-100)、matchedStrengths、gaps；匹配分仅供参考，filter只表达是否违反用户附加条件。"
        question += "\n简历原文：\n" + resume_text[:30000]
        if settings.confirmed_education:
            question += "\n用户明确确认的学历事实：" + settings.confirmed_education
    answer = await model.complete(
        config,
        [{"role": "system", "content": system}, {"role": "user", "content": question}],
        task="filter",
    )
    try:
        raw = structured_object(answer)
        for alias in ("matchScore", "matchingScore", "resumeMatchScore"):
            if alias in raw:
                raw.setdefault("score", raw.pop(alias))
        result = FilterOutput.model_validate(raw)
        if payload.resumeMatchEnabled and result.score is None:
            raise ValueError("Missing matching score")
        if result.decisionStatus == "UNKNOWN":
            return {"decisionStatus": "UNKNOWN", "filter": True, "reason": result.reason}
        if result.decisionStatus and result.decisionStatus != (
            "REJECT" if result.filter else "MATCH"
        ):
            raise ValueError("Contradictory decision")
    except (ValueError, TypeError):
        raise ApiError("AI筛选结果不符合协议，本次不投递", 502) from None
    response = result.model_dump(exclude_none=True)
    if payload.resumeMatchEnabled:
        response.update(decisionStatus="REJECT" if result.filter else "MATCH", engine="AI")
    return response
