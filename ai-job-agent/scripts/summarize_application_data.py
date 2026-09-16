#!/usr/bin/env python3
"""Clean and summarize Job Helper application, conversation, and resume data.

The script is deliberately read-only. It queries the local MySQL container and
writes derived artifacts to a new output directory without changing source data.
It uses only Python's standard library and the mysql client already present in
the MySQL container.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


MYSQL_COMMAND = (
    'mysql --default-character-set=utf8mb4 '
    '-u"${MYSQL_USER:-ai_job}" -p"$MYSQL_PASSWORD" '
    '--batch --raw --skip-column-names "${MYSQL_DATABASE:-ai_job}"'
)

REJECTION_PATTERNS = tuple(
    re.compile(pattern, re.I)
    for pattern in (
        r"不太合适|不合适|不太适合|暂时不适合",
        r"不匹配|不够匹配|不是很匹配|暂不匹配",
        r"不完全匹配|不完全吻合|并不完全吻合|契合度较低",
        r"不继续推进|不能与您共事|没办法向后推进",
        r"其他背景的候选人|不同工作年限|不同经验范围|更广泛经验",
        r"进入了进一步的讨论阶段|项目周期更匹配",
        r"面试没有通过|面试未通过",
        r"综合评估不是特别匹配|岗位需求与你暂不匹配",
        r"需求不完全一致",
    )
)

INTERVIEW_PATTERNS = tuple(
    re.compile(pattern, re.I)
    for pattern in (
        r"BOSS已进入面试间|面试已结束",
        r"面试没有通过|面试未通过",
        r"什么时候方便.{0,12}面试|周[一二三四五六日天].{0,16}面试",
        r"方便.{0,12}(?:来|过来|参加).{0,8}面试",
        r"下周.{0,16}来面试|线下面试方便",
        r"邀请.{0,12}面试|面试邀请",
        r"笔试须知|笔试题目|发送题目并开始计时",
    )
)

CONDITIONAL_INTERVIEW_PATTERNS = tuple(
    re.compile(pattern, re.I)
    for pattern in (
        r"合适.{0,16}(?:联系|通知|安排|邀约).{0,8}面试",
        r"通过.{0,16}(?:联系|通知|安排|邀约).{0,8}面试",
        r"有面试机会|后续.{0,12}安排面试",
        r"评估通过后.{0,16}面试",
    )
)

READ_PATTERNS = tuple(
    re.compile(pattern, re.I)
    for pattern in (r"已读", r"已查看", r"查看了.{0,8}简历", r"简历已被查看")
)

SKILL_ALIASES: dict[str, tuple[str, ...]] = {
    "Python": ("python",),
    "FastAPI": ("fastapi",),
    "Django": ("django", "drf"),
    "Java": ("java",),
    "Spring": ("spring", "spring boot"),
    "Go": ("golang", "go语言", "go 开发", "go开发"),
    "PHP": ("php",),
    "C++": ("c++",),
    "JavaScript/TypeScript": ("javascript", "typescript"),
    "Vue/Nuxt": ("vue", "nuxt"),
    "React": ("react",),
    "Node.js": ("node.js", "nodejs", "node 后端", "node后端"),
    "Agent/智能体": ("agent", "智能体"),
    "LangGraph": ("langgraph",),
    "LangChain": ("langchain",),
    "RAG": ("rag", "检索增强"),
    "AI/大模型": ("大模型", "llm", "aigc", "人工智能"),
    "机器学习/深度学习": ("机器学习", "深度学习", "pytorch", "tensorflow"),
    "ComfyUI": ("comfyui",),
    "MySQL": ("mysql",),
    "PostgreSQL": ("postgresql", "postgres"),
    "Redis": ("redis",),
    "Docker": ("docker",),
    "Kubernetes": ("kubernetes", "k8s"),
    "Celery": ("celery",),
    "Three.js/WebGL": ("three.js", "threejs", "webgl"),
    "自动化测试": ("自动化测试", "测试开发", "pytest", "junit"),
    "爬虫": ("爬虫", "scrapy"),
    "RPA": ("rpa", "影刀"),
}

EXPERIENCE_MIN_MONTHS = {
    "在校/应届": 0,
    "经验不限": 0,
    "1年以内": 0,
    "1-3年": 12,
    "3-5年": 36,
    "5-10年": 60,
    "10年以上": 120,
}

SYSTEM_NOISE_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("COMPETITION_CARD", re.compile(r"^你与该职位竞争者PK情况$")),
    ("ATTACHMENT_SENT", re.compile(r"附件简历已发送|附件简历请求已发送")),
    ("ATTACHMENT_FILE", re.compile(r"\.(?:pdf|docx?|png|jpe?g)$", re.I)),
    ("INTERVIEW_SYSTEM", re.compile(r"^BOSS已进入面试间$|^面试已结束$")),
)


def normalize_text(value: Any, *, collapse: bool = True) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value)).replace("\u200b", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if collapse:
        text = re.sub(r"\s+", " ", text)
    return text


def mask_pii(text: str) -> str:
    text = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "[PHONE]", text)
    text = re.sub(
        r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[EMAIL]", text, flags=re.I
    )
    return text


def parse_json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def epoch_ms_to_iso(value: Any) -> str:
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        return ""
    if timestamp <= 0:
        return ""
    return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).isoformat()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def matches_any(text: str, patterns: Iterable[re.Pattern[str]]) -> bool:
    return any(pattern.search(text) for pattern in patterns)


def message_noise_type(text: str) -> str:
    if not text:
        return "EMPTY"
    if matches_any(text, READ_PATTERNS):
        return "READ_RECEIPT"
    for noise_type, pattern in SYSTEM_NOISE_RULES:
        if pattern.search(text):
            return noise_type
    return ""


def clean_messages(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        text = normalize_text(row.get("text"))
        role = normalize_text(row.get("role")).upper() or "UNKNOWN"
        sent_at = int(row.get("sent_at") or 0)
        observed_at = int(row.get("observed_at") or 0)
        order_at = int(row.get("order_at") or sent_at or observed_at or 0)
        message_id = normalize_text(row.get("message_id"))
        identity = message_id or sha256_text(
            "|".join((normalize_text(row.get("encrypt_job_id")), role, text, str(order_at)))
        )
        if identity in seen:
            continue
        seen.add(identity)
        noise_type = message_noise_type(text)
        conditional_interview = matches_any(text, CONDITIONAL_INTERVIEW_PATTERNS)
        cleaned.append(
            {
                "message_id": identity,
                "role": role,
                "author_kind": normalize_text(row.get("author_kind")).upper(),
                "text": text,
                "sent_at": sent_at or None,
                "sent_at_iso": epoch_ms_to_iso(sent_at),
                "observed_at": observed_at or None,
                "order_at": order_at,
                "delivery_state": normalize_text(row.get("delivery_state")).upper(),
                "noise_type": noise_type or None,
                "is_meaningful": not noise_type,
                "is_explicit_rejection": role == "HR" and matches_any(text, REJECTION_PATTERNS),
                "is_read_evidence": noise_type == "READ_RECEIPT",
                "is_interview_progress": (
                    role == "HR"
                    and matches_any(text, INTERVIEW_PATTERNS)
                    and not conditional_interview
                ),
                "is_conditional_interview": role == "HR" and conditional_interview,
            }
        )
    cleaned.sort(key=lambda item: (item["order_at"], item["message_id"]))
    return cleaned


def extract_skills(text: str) -> set[str]:
    normalized = normalize_text(text).lower()
    found: set[str] = set()
    for canonical, aliases in SKILL_ALIASES.items():
        if any(alias.lower() in normalized for alias in aliases):
            found.add(canonical)
    return found


def month_index(year: int, month: int) -> int:
    return year * 12 + month


def extract_experience_months(resume_text: str) -> tuple[int, list[int]]:
    normalized = unicodedata.normalize("NFKC", resume_text)
    work_section = normalized
    if "工作经历" in normalized:
        work_section = normalized.split("工作经历", 1)[1]
    if "项目经历" in work_section:
        work_section = work_section.split("项目经历", 1)[0]
    durations: list[int] = []
    pattern = re.compile(
        r"(20\d{2})[./年](0?[1-9]|1[0-2])(?:月)?\s*[-–—至~]+\s*"
        r"(?:(20\d{2})[./年](0?[1-9]|1[0-2])(?:月)?|至今)"
    )
    now = datetime.now()
    for match in pattern.finditer(work_section):
        start_year, start_month = int(match.group(1)), int(match.group(2))
        end_year = int(match.group(3)) if match.group(3) else now.year
        end_month = int(match.group(4)) if match.group(4) else now.month
        duration = month_index(end_year, end_month) - month_index(start_year, start_month) + 1
        if 0 < duration <= 240:
            durations.append(duration)
    return sum(durations), durations


def resume_profile(text: str) -> dict[str, Any]:
    normalized = normalize_text(text, collapse=False)
    months, stints = extract_experience_months(normalized)
    return {
        "experience_months": months,
        "employment_stints_months": stints,
        "short_stints_under_6_months": sum(months < 6 for months in stints),
        "skills": sorted(extract_skills(normalized)),
        "education_signals": sorted(
            signal
            for signal in ("本科", "硕士", "全日制", "统招", "双证", "学士")
            if signal in normalized
        ),
    }


def role_family(job_title: str) -> str:
    title = normalize_text(job_title).lower()
    rules = (
        ("测试/质量", r"测试|测开|质量|qa"),
        ("Java", r"java"),
        ("前端", r"前端|react|vue"),
        ("Python/RPA/爬虫", r"python|爬虫|rpa"),
        ("AI/Agent/算法", r"agent|智能体|大模型|aigc|算法|ai|模型"),
        ("全栈", r"全栈"),
        ("其他后端/研发", r"后端|golang|go开发|php|c\+\+|软件开发|研发"),
        ("内容/设计/运营", r"视频|剪辑|设计|生成师|策划|运营"),
    )
    for label, pattern in rules:
        if re.search(pattern, title, flags=re.I):
            return label
    return "其他"


def mismatch_analysis(
    job: dict[str, Any], resume: dict[str, Any], resume_text: str
) -> dict[str, Any]:
    base = parse_json_object(job.get("job_base_info"))
    ext = parse_json_object(job.get("job_ext_info"))
    title = normalize_text(base.get("jobName") or job.get("job_title"))
    description = normalize_text(ext.get("postDescription"), collapse=False)
    jd_text = f"{title}\n{description}"
    jd_skills = extract_skills(jd_text)
    resume_skills = set(resume.get("skills") or extract_skills(resume_text))
    missing_skills = sorted(jd_skills - resume_skills)
    experience_required = normalize_text(base.get("jobExperience"))
    required_months = EXPERIENCE_MIN_MONTHS.get(experience_required, 0)
    resume_months = int(resume.get("experience_months") or 0)
    flags: list[str] = []
    if required_months and resume_months < required_months:
        flags.append("EXPERIENCE_GAP")
    if missing_skills:
        flags.append("HARD_SKILL_GAPS")
    if re.search(r"统招|双证|985|211|硕士|研究生|一本", jd_text, flags=re.I):
        flags.append("EDUCATION_BARRIER")
    if re.search(r"作品|案例|portfolio|github|链接", jd_text, flags=re.I):
        flags.append("PORTFOLIO_REQUIRED")
    if re.search(r"电商|商城|金融|游戏|服饰|短剧|影视|自媒体|广告|零售", jd_text):
        flags.append("DOMAIN_EXPERIENCE_REQUIRED")
    if int(resume.get("short_stints_under_6_months") or 0) > 0:
        flags.append("SHORT_TENURE_SIGNAL")
    return {
        "role_family": role_family(title),
        "experience_required": experience_required,
        "required_experience_months": required_months,
        "resume_experience_months": resume_months,
        "jd_skills": sorted(jd_skills),
        "resume_skills": sorted(resume_skills),
        "missing_skills": missing_skills,
        "reason_flags": flags,
    }


def classify_job(
    job: dict[str, Any],
    messages: list[dict[str, Any]],
    outcome: dict[str, Any],
    *,
    as_of_ms: int,
    mature_hours: int,
) -> dict[str, Any]:
    meaningful = [message for message in messages if message["is_meaningful"]]
    hr_messages = [message for message in meaningful if message["role"] == "HR"]
    user_messages = [message for message in meaningful if message["role"] == "USER"]
    rejection_evidence = [
        message["text"] for message in messages if message["is_explicit_rejection"]
    ]
    interview_evidence = [
        message["text"] for message in messages if message["is_interview_progress"]
    ]
    read_evidence = [message["text"] for message in messages if message["is_read_evidence"]]
    report = parse_json_object(outcome.get("report_json"))
    report_read_state = normalize_text(report.get("readState")).upper()
    if report_read_state and report_read_state != "UNKNOWN":
        read_evidence.append(f"outcome_report:{report_read_state}")

    applied_at = int(job.get("applied_at") or 0)
    last_activity = max(
        [applied_at]
        + [int(message.get("order_at") or 0) for message in messages]
    )
    age_hours = max(0.0, (as_of_ms - applied_at) / 3_600_000) if applied_at else 0.0
    idle_hours = max(0.0, (as_of_ms - last_activity) / 3_600_000) if last_activity else 0.0
    last_meaningful = meaningful[-1] if meaningful else None
    waiting_on = "UNKNOWN"
    if last_meaningful:
        waiting_on = "HR" if last_meaningful["role"] == "USER" else "USER"

    if rejection_evidence and interview_evidence:
        status = "INTERVIEW_REJECTED"
    elif rejection_evidence:
        status = "EXPLICIT_REJECTION"
    elif interview_evidence:
        status = "INTERVIEW_PROGRESS"
    elif read_evidence and waiting_on == "HR" and idle_hours >= mature_hours:
        status = "READ_NO_REPLY"
    elif hr_messages and waiting_on == "HR" and idle_hours >= mature_hours:
        status = "HR_REPLIED_STALLED"
    elif hr_messages:
        status = "HR_REPLIED_NO_INTERVIEW"
    elif age_hours >= mature_hours:
        status = "STALE_NO_REPLY_UNVERIFIED_READ"
    else:
        status = "PENDING_NO_REPLY"

    return {
        "status": status,
        "waiting_on": waiting_on,
        "read_state": "READ" if read_evidence else report_read_state or "UNKNOWN",
        "age_hours": round(age_hours, 1),
        "idle_hours": round(idle_hours, 1),
        "meaningful_hr_count": len(hr_messages),
        "meaningful_user_count": len(user_messages),
        "rejection_evidence": rejection_evidence,
        "interview_evidence": interview_evidence,
        "read_evidence": read_evidence,
        "latest_hr_text": hr_messages[-1]["text"] if hr_messages else "",
    }


class DockerMySQLReader:
    def __init__(self, container: str) -> None:
        self.container = container

    def fetch_json_rows(self, sql: str) -> list[dict[str, Any]]:
        command = ["docker", "exec", "-i", self.container, "sh", "-lc", MYSQL_COMMAND]
        completed = subprocess.run(
            command,
            input=sql,
            text=True,
            encoding="utf-8",
            capture_output=True,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip() or completed.stdout.strip()
            raise RuntimeError(f"MySQL query failed: {detail}")
        rows: list[dict[str, Any]] = []
        for line in completed.stdout.splitlines():
            if not line.strip():
                continue
            try:
                payload = bytes.fromhex(line.strip()).decode("utf-8")
                value = json.loads(payload)
            except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
                detail = error.msg if isinstance(error, json.JSONDecodeError) else str(error)
                column = error.colno if isinstance(error, json.JSONDecodeError) else "unknown"
                raise RuntimeError(
                    "MySQL returned invalid JSON "
                    f"({detail} at column {column}): {line[:200]}"
                ) from error
            if isinstance(value, dict):
                rows.append(value)
        return rows

    def table_exists(self, table: str) -> bool:
        safe_table = re.sub(r"[^a-zA-Z0-9_]", "", table)
        rows = self.fetch_json_rows(
            "SELECT HEX(JSON_OBJECT('present', COUNT(*))) "
            "FROM information_schema.tables "
            f"WHERE table_schema = DATABASE() AND table_name = '{safe_table}';"
        )
        return bool(rows and int(rows[0].get("present") or 0))


def load_database(reader: DockerMySQLReader, user_id: int) -> dict[str, list[dict[str, Any]]]:
    snapshots = reader.fetch_json_rows(
        "SELECT HEX(JSON_OBJECT("
        "'id', id, 'user_id', user_id, 'encrypt_job_id', encrypt_job_id, "
        "'applied_at', applied_at, 'job_base_info', job_base_info, "
        "'job_ext_info', job_ext_info, 'resume_record_id', resume_record_id, "
        "'resume_content', resume_content, 'resume_hash', resume_hash, "
        "'preference_snapshot', preference_snapshot, 'pre_match_result', pre_match_result"
        f")) FROM job_application_snapshot WHERE user_id = {user_id} ORDER BY applied_at, id;"
    )
    messages: list[dict[str, Any]] = []
    if reader.table_exists("conversation_message"):
        messages = reader.fetch_json_rows(
            "SELECT HEX(JSON_OBJECT("
            "'id', id, 'encrypt_job_id', encrypt_job_id, 'conversation_key', conversation_key, "
            "'boss_id', boss_id, 'message_id', message_id, 'role', role, "
            "'author_kind', author_kind, 'text', text, 'sent_at', sent_at, "
            "'observed_at', observed_at, 'order_at', order_at, "
            "'delivery_state', delivery_state"
            f")) FROM conversation_message WHERE user_id = {user_id} ORDER BY encrypt_job_id, order_at, id;"
        )
    outcomes: list[dict[str, Any]] = []
    if reader.table_exists("outcome_case") and reader.table_exists("outcome_report"):
        outcomes = reader.fetch_json_rows(
            "SELECT HEX(JSON_OBJECT("
            "'encrypt_job_id', c.encrypt_job_id, 'case_id', c.id, 'status', c.status, "
            "'facts_json', c.facts_json, 'report_json', r.report_json, "
            "'report_id', r.id, 'report_updated_at', r.updated_at"
            ")) FROM outcome_case c LEFT JOIN outcome_report r ON r.id = c.current_report_id "
            f"WHERE c.user_id = {user_id};"
        )
    user_resumes: list[dict[str, Any]] = []
    if reader.table_exists("user_resume"):
        user_resumes = reader.fetch_json_rows(
            "SELECT HEX(JSON_OBJECT("
            "'source', 'user_resume', 'source_id', id, 'resume_id', resume_id, "
            "'content', resume_content, 'is_active', is_active, "
            "'created_at', UNIX_TIMESTAMP(created_date) * 1000, "
            "'updated_at', UNIX_TIMESTAMP(updated_date) * 1000"
            f")) FROM user_resume WHERE user_id = {user_id} ORDER BY created_date, id;"
        )
    career_resumes: list[dict[str, Any]] = []
    if reader.table_exists("career_resume_version"):
        career_resumes = reader.fetch_json_rows(
            "SELECT HEX(JSON_OBJECT("
            "'source', 'career_resume_version', 'source_id', id, 'content_hash', content_hash, "
            "'data_json', data_json, 'created_at', created_at"
            f")) FROM career_resume_version WHERE user_id = {user_id} ORDER BY created_at, id;"
        )
    return {
        "snapshots": snapshots,
        "messages": messages,
        "outcomes": outcomes,
        "user_resumes": user_resumes,
        "career_resumes": career_resumes,
    }


def build_resume_versions(
    data: dict[str, list[dict[str, Any]]], *, include_pii: bool
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    by_hash: dict[str, dict[str, Any]] = {}

    def add_version(content: Any, source: str, source_id: Any, timestamp: Any) -> None:
        normalized = normalize_text(content, collapse=False)
        if not normalized:
            return
        digest = sha256_text(normalized)
        version = by_hash.setdefault(
            digest,
            {
                "resume_hash": digest,
                "content": normalized if include_pii else mask_pii(normalized),
                "profile": resume_profile(normalized),
                "sources": [],
                "application_count": 0,
                "first_applied_at": None,
                "last_applied_at": None,
            },
        )
        source_record = {"source": source, "source_id": str(source_id or "")}
        if timestamp:
            source_record["observed_at"] = int(timestamp)
            source_record["observed_at_iso"] = epoch_ms_to_iso(timestamp)
        source_already_recorded = source == "job_application_snapshot" and any(
            item["source"] == source for item in version["sources"]
        )
        if not source_already_recorded and source_record not in version["sources"]:
            version["sources"].append(source_record)

    for row in data["user_resumes"]:
        add_version(row.get("content"), row.get("source", "user_resume"), row.get("source_id"), row.get("updated_at"))
    for row in data["career_resumes"]:
        payload = parse_json_object(row.get("data_json"))
        add_version(payload.get("content"), row.get("source", "career_resume_version"), row.get("source_id"), row.get("created_at"))
    for row in data["snapshots"]:
        add_version(row.get("resume_content"), "job_application_snapshot", row.get("id"), row.get("applied_at"))
        normalized = normalize_text(row.get("resume_content"), collapse=False)
        if not normalized:
            continue
        digest = sha256_text(normalized)
        version = by_hash[digest]
        applied_at = int(row.get("applied_at") or 0)
        version["application_count"] += 1
        first = version["first_applied_at"]
        last = version["last_applied_at"]
        version["first_applied_at"] = applied_at if first is None else min(first, applied_at)
        version["last_applied_at"] = applied_at if last is None else max(last, applied_at)

    versions = sorted(
        by_hash.values(),
        key=lambda item: (item["last_applied_at"] or 0, item["resume_hash"]),
    )
    return versions, by_hash


def build_job_records(
    data: dict[str, list[dict[str, Any]]],
    resume_by_hash: dict[str, dict[str, Any]],
    *,
    as_of_ms: int,
    mature_hours: int,
) -> list[dict[str, Any]]:
    messages_by_job: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for message in data["messages"]:
        messages_by_job[normalize_text(message.get("encrypt_job_id"))].append(message)
    outcomes_by_job = {
        normalize_text(row.get("encrypt_job_id")): row for row in data["outcomes"]
    }
    jobs: list[dict[str, Any]] = []
    for snapshot in data["snapshots"]:
        job_id = normalize_text(snapshot.get("encrypt_job_id"))
        base = parse_json_object(snapshot.get("job_base_info"))
        ext = parse_json_object(snapshot.get("job_ext_info"))
        resume_text = normalize_text(snapshot.get("resume_content"), collapse=False)
        computed_resume_hash = sha256_text(resume_text) if resume_text else ""
        resume_version = resume_by_hash.get(computed_resume_hash, {})
        profile = resume_version.get("profile") or resume_profile(resume_text)
        messages = clean_messages(messages_by_job.get(job_id, []))
        classification = classify_job(
            snapshot,
            messages,
            outcomes_by_job.get(job_id, {}),
            as_of_ms=as_of_ms,
            mature_hours=mature_hours,
        )
        mismatch = mismatch_analysis(snapshot, profile, resume_text)
        jobs.append(
            {
                "record_scope": "APPLICATION",
                "applied_at_source": "JOB_APPLICATION_SNAPSHOT",
                "data_quality_flags": [],
                "encrypt_job_id": job_id,
                "applied_at": int(snapshot.get("applied_at") or 0),
                "applied_at_iso": epoch_ms_to_iso(snapshot.get("applied_at")),
                "company": normalize_text(base.get("brandName")),
                "job_title": normalize_text(base.get("jobName")),
                "city": normalize_text(base.get("cityName")),
                "salary": normalize_text(base.get("salaryDesc")),
                "degree_required": normalize_text(base.get("jobDegree")),
                "experience_required": normalize_text(base.get("jobExperience")),
                "job_description": normalize_text(ext.get("postDescription"), collapse=False),
                "resume_hash": computed_resume_hash,
                "resume_record_id": snapshot.get("resume_record_id"),
                "preference_snapshot": parse_json_object(snapshot.get("preference_snapshot")),
                "pre_match_result": parse_json_object(snapshot.get("pre_match_result")),
                "classification": classification,
                "mismatch": mismatch,
                "messages": messages,
            }
        )
    known_job_ids = {job["encrypt_job_id"] for job in jobs}
    for job_id, raw_messages in messages_by_job.items():
        if not job_id or job_id in known_job_ids:
            continue
        messages = clean_messages(raw_messages)
        first_observed_at = min(
            (int(message.get("order_at") or 0) for message in messages if message.get("order_at")),
            default=0,
        )
        synthetic = {"applied_at": first_observed_at}
        classification = classify_job(
            synthetic,
            messages,
            outcomes_by_job.get(job_id, {}),
            as_of_ms=as_of_ms,
            mature_hours=mature_hours,
        )
        jobs.append(
            {
                "record_scope": "CONVERSATION_ONLY",
                "applied_at_source": "FIRST_MESSAGE_FALLBACK",
                "data_quality_flags": [
                    "NO_APPLICATION_SNAPSHOT",
                    "NO_HISTORICAL_RESUME",
                ],
                "encrypt_job_id": job_id,
                "applied_at": first_observed_at,
                "applied_at_iso": epoch_ms_to_iso(first_observed_at),
                "company": "",
                "job_title": "",
                "city": "",
                "salary": "",
                "degree_required": "",
                "experience_required": "",
                "job_description": "",
                "resume_hash": "",
                "resume_record_id": None,
                "preference_snapshot": {},
                "pre_match_result": {},
                "classification": classification,
                "mismatch": {
                    "role_family": "未知",
                    "experience_required": "",
                    "required_experience_months": 0,
                    "resume_experience_months": 0,
                    "jd_skills": [],
                    "resume_skills": [],
                    "missing_skills": [],
                    "reason_flags": [],
                },
                "messages": messages,
            }
        )
    jobs.sort(key=lambda item: (item["applied_at"], item["encrypt_job_id"]))
    return jobs


def summarize(jobs: list[dict[str, Any]], resumes: list[dict[str, Any]]) -> dict[str, Any]:
    statuses = Counter(job["classification"]["status"] for job in jobs)
    application_jobs = [job for job in jobs if job["record_scope"] == "APPLICATION"]
    application_statuses = Counter(
        job["classification"]["status"] for job in application_jobs
    )
    role_families = Counter(job["mismatch"]["role_family"] for job in jobs)
    experience_requirements = Counter(job["experience_required"] or "未知" for job in jobs)
    reason_flags = Counter(
        flag for job in jobs for flag in job["mismatch"]["reason_flags"]
    )
    explicit_rejections = [
        job for job in jobs if job["classification"]["status"] in {"EXPLICIT_REJECTION", "INTERVIEW_REJECTED"}
    ]
    rejection_reasons = Counter(
        flag for job in explicit_rejections for flag in job["mismatch"]["reason_flags"]
    )
    data_quality = {
        "conversation_only_records": sum(
            job["record_scope"] == "CONVERSATION_ONLY" for job in jobs
        ),
        "application_jobs_without_any_message": sum(
            not job["messages"] for job in application_jobs
        ),
        "jobs_without_meaningful_hr_message": sum(
            job["classification"]["meaningful_hr_count"] == 0 for job in jobs
        ),
        "jobs_with_read_evidence": sum(
            bool(job["classification"]["read_evidence"]) for job in jobs
        ),
        "jobs_with_outcome_read_unknown": sum(
            job["classification"]["read_state"] == "UNKNOWN" for job in jobs
        ),
    }
    return {
        "total_records": len(jobs),
        "total_application_jobs": len(application_jobs),
        "total_conversation_only_records": len(jobs) - len(application_jobs),
        "total_resume_versions": len(resumes),
        "status_counts": dict(statuses.most_common()),
        "application_status_counts": dict(application_statuses.most_common()),
        "role_family_counts": dict(role_families.most_common()),
        "experience_requirement_counts": dict(experience_requirements.most_common()),
        "reason_flag_counts": dict(reason_flags.most_common()),
        "explicit_rejection_count": len(explicit_rejections),
        "explicit_rejection_reason_counts": dict(rejection_reasons.most_common()),
        "data_quality": data_quality,
    }


def csv_join(values: Iterable[Any]) -> str:
    return " | ".join(normalize_text(value) for value in values if normalize_text(value))


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def write_job_csv(path: Path, jobs: list[dict[str, Any]]) -> None:
    fields = [
        "record_scope",
        "applied_at_source",
        "data_quality_flags",
        "encrypt_job_id",
        "applied_at_iso",
        "company",
        "job_title",
        "city",
        "salary",
        "experience_required",
        "degree_required",
        "role_family",
        "status",
        "waiting_on",
        "read_state",
        "age_hours",
        "idle_hours",
        "meaningful_hr_count",
        "meaningful_user_count",
        "resume_hash",
        "resume_experience_months",
        "missing_skills",
        "reason_flags",
        "rejection_evidence",
        "interview_evidence",
        "read_evidence",
        "latest_hr_text",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for job in jobs:
            classification = job["classification"]
            mismatch = job["mismatch"]
            writer.writerow(
                {
                    "record_scope": job["record_scope"],
                    "applied_at_source": job["applied_at_source"],
                    "data_quality_flags": csv_join(job["data_quality_flags"]),
                    "encrypt_job_id": job["encrypt_job_id"],
                    "applied_at_iso": job["applied_at_iso"],
                    "company": job["company"],
                    "job_title": job["job_title"],
                    "city": job["city"],
                    "salary": job["salary"],
                    "experience_required": job["experience_required"],
                    "degree_required": job["degree_required"],
                    "role_family": mismatch["role_family"],
                    "status": classification["status"],
                    "waiting_on": classification["waiting_on"],
                    "read_state": classification["read_state"],
                    "age_hours": classification["age_hours"],
                    "idle_hours": classification["idle_hours"],
                    "meaningful_hr_count": classification["meaningful_hr_count"],
                    "meaningful_user_count": classification["meaningful_user_count"],
                    "resume_hash": job["resume_hash"],
                    "resume_experience_months": mismatch["resume_experience_months"],
                    "missing_skills": csv_join(mismatch["missing_skills"]),
                    "reason_flags": csv_join(mismatch["reason_flags"]),
                    "rejection_evidence": csv_join(classification["rejection_evidence"]),
                    "interview_evidence": csv_join(classification["interview_evidence"]),
                    "read_evidence": csv_join(classification["read_evidence"]),
                    "latest_hr_text": classification["latest_hr_text"],
                }
            )


def markdown_table(mapping: dict[str, int], total: int) -> str:
    lines = ["| 分类 | 数量 | 占比 |", "| --- | ---: | ---: |"]
    for label, count in mapping.items():
        ratio = (count / total * 100) if total else 0
        lines.append(f"| {label} | {count} | {ratio:.1f}% |")
    return "\n".join(lines)


def render_markdown(summary: dict[str, Any], *, user_id: int, mature_hours: int, as_of_ms: int) -> str:
    quality = summary["data_quality"]
    lines = [
        "# 投递、会话与简历清洗报告",
        "",
        f"- 用户 ID：{user_id}",
        f"- 分析时间：{epoch_ms_to_iso(as_of_ms)}",
        f"- 无回复成熟阈值：{mature_hours} 小时",
        f"- 投递快照岗位：{summary['total_application_jobs']}",
        f"- 仅有会话、缺少投递快照的岗位：{summary['total_conversation_only_records']}",
        f"- 合并后的岗位/会话记录：{summary['total_records']}",
        f"- 去重后的历史简历版本：{summary['total_resume_versions']}",
        "",
        "## 结果分布",
        "",
        markdown_table(summary["status_counts"], summary["total_records"]),
        "",
        "## 明确拒绝岗位的推断风险",
        "",
        f"明确拒绝岗位共 {summary['explicit_rejection_count']} 个。下列风险来自投递时 JD 与对应简历快照的对照，可能重叠，不等同于 HR 明示原因。",
        "",
        markdown_table(
            summary["explicit_rejection_reason_counts"],
            summary["explicit_rejection_count"],
        ),
        "",
        "## 岗位方向",
        "",
        markdown_table(summary["role_family_counts"], summary["total_records"]),
        "",
        "## 数据质量",
        "",
        f"- 缺少投递快照、仅有会话的岗位：{quality['conversation_only_records']}",
        f"- 没有任何会话记录的投递岗位：{quality['application_jobs_without_any_message']}",
        f"- 没有有效 HR 内容的岗位：{quality['jobs_without_meaningful_hr_message']}",
        f"- 存在明确已读证据的岗位：{quality['jobs_with_read_evidence']}",
        f"- 已读状态仍为 UNKNOWN 的岗位：{quality['jobs_with_outcome_read_unknown']}",
        "",
        "> `STALE_NO_REPLY_UNVERIFIED_READ` 只表示超过阈值仍无有效回复，不能伪装成“已读未回”。只有存在已读证据时才会标记 `READ_NO_REPLY`。",
        "",
        "## 输出说明",
        "",
        "- `job_details.csv`：每个投递岗位一行，便于筛选、透视和人工复核。",
        "- `cleaned_conversations.jsonl`：每个岗位的完整清洗会话，保留噪声标签和证据标签。",
        "- `cleaned_resumes.jsonl`：所有历史简历版本，按内容去重并标注使用次数。",
        "- `summary.json`：机器可读汇总。",
        "",
    ]
    return "\n".join(lines)


def parse_as_of(value: str | None) -> int:
    if not value:
        return int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def run(args: argparse.Namespace) -> Path:
    reader = DockerMySQLReader(args.container)
    data = load_database(reader, args.user_id)
    if not data["snapshots"]:
        raise RuntimeError(f"No job_application_snapshot rows found for user {args.user_id}")
    resumes, resume_by_hash = build_resume_versions(data, include_pii=args.include_pii)
    as_of_ms = parse_as_of(args.as_of)
    jobs = build_job_records(
        data,
        resume_by_hash,
        as_of_ms=as_of_ms,
        mature_hours=args.mature_hours,
    )
    summary = summarize(jobs, resumes)
    summary.update(
        {
            "user_id": args.user_id,
            "as_of": epoch_ms_to_iso(as_of_ms),
            "mature_hours": args.mature_hours,
        }
    )
    output_dir = Path(args.output_dir) if args.output_dir else Path("reports") / (
        "application-data-summary-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    )
    output_dir.mkdir(parents=True, exist_ok=False)
    write_job_csv(output_dir / "job_details.csv", jobs)
    write_jsonl(
        output_dir / "cleaned_conversations.jsonl",
        (
            {
                "record_scope": job["record_scope"],
                "data_quality_flags": job["data_quality_flags"],
                "encrypt_job_id": job["encrypt_job_id"],
                "company": job["company"],
                "job_title": job["job_title"],
                "classification": job["classification"],
                "messages": job["messages"],
            }
            for job in jobs
        ),
    )
    write_jsonl(output_dir / "cleaned_resumes.jsonl", resumes)
    (output_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / "summary.md").write_text(
        render_markdown(
            summary,
            user_id=args.user_id,
            mature_hours=args.mature_hours,
            as_of_ms=as_of_ms,
        ),
        encoding="utf-8",
    )
    return output_dir.resolve()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Clean and summarize all Job Helper applications, conversations, and resumes."
    )
    parser.add_argument("--user-id", type=int, required=True, help="Job Helper user_id")
    parser.add_argument(
        "--container", default="job-helper-mysql", help="MySQL Docker container name"
    )
    parser.add_argument(
        "--mature-hours",
        type=int,
        default=72,
        help="Hours after which an unanswered application is considered stale",
    )
    parser.add_argument("--as-of", help="ISO-8601 analysis time; defaults to now")
    parser.add_argument("--output-dir", help="New directory for generated artifacts")
    parser.add_argument(
        "--include-pii",
        action="store_true",
        help="Keep phone and email in cleaned resume output (masked by default)",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.user_id <= 0:
        raise SystemExit("--user-id must be positive")
    if args.mature_hours <= 0:
        raise SystemExit("--mature-hours must be positive")
    try:
        output_dir = run(args)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
