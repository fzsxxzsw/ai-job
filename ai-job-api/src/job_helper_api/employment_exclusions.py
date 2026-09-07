"""Deterministic, reversible job and conversation exclusion rules."""

import re
import unicodedata

from sqlalchemy import select

from .database import loads

HUNTER_MARKER = "平台猎头标记"
HUNTER_WORDS = ["猎头", "猎聘顾问", "headhunter", "head hunter"]
NEGATED = re.compile(r"(?:不是|并非|不属于|非|没有|不接受|不考虑|拒绝)\s*$", re.I)


def enabled(value):
    return (
        value is True
        or value == 1
        or (isinstance(value, str) and value.strip().lower() in ("true", "1"))
    )


def exclusion_keywords(pref):
    values = (
        pref.get("employmentExcludeKeywords") if enabled(pref.get("employmentExcludeE")) else []
    )
    values = values if isinstance(values, list) else []
    if enabled(pref.get("fhE")):
        values = values + HUNTER_WORDS
    return list(
        dict.fromkeys(
            unicodedata.normalize("NFKC", value).strip().lower()
            for value in values
            if isinstance(value, str) and value.strip()
        )
    )


def match_employment_exclusion(pref, *sources):
    words = exclusion_keywords(pref)

    def visit(value, depth=0):
        if depth > 8:
            return None
        if isinstance(value, str):
            text = unicodedata.normalize("NFKC", value).lower()
            for word in words:
                for match in re.finditer(re.escape(word), text):
                    start, end = match.span()
                    if re.fullmatch(r"[a-z ]+", word) and (
                        re.search(r"[a-z]", text[start - 1 : start] if start else "")
                        or re.search(r"[a-z]", text[end : end + 1])
                    ):
                        continue
                    if not NEGATED.search(text[max(0, start - 12) : start]):
                        return word
        elif isinstance(value, dict):
            if enabled(pref.get("fhE")) and enabled(value.get("goldHunter")):
                return HUNTER_MARKER
            return visit(list(value.values()), depth + 1)
        elif isinstance(value, list | tuple):
            for item in value:
                if hit := visit(item, depth + 1):
                    return hit
        return None

    return visit(sources)


async def conversation_exclusion(db, uid, key, question, job_info):
    user = await db.user(uid)
    pref = loads((user or {}).get("preference"), {})
    pref = pref if isinstance(pref, dict) else {}
    control_key = "employment-exclusion:" + key
    remembered = await db.control(uid, control_key, [])
    remembered = remembered if isinstance(remembered, list) else []
    sessions = db.table("msg_session")
    session = await db.one(
        select(sessions)
        .where(
            sessions.c.user_id == uid,
            db.exact(sessions.c.session_key, key),
            sessions.c.is_active.is_(True),
            sessions.c.status == 1,
        )
        .order_by(sessions.c.id.desc())
        .limit(1)
    )
    history = loads(session["msg_context"], []) if session else []
    # A candidate's own refusal or model prose is not evidence about the employer.
    recruiter_text = (
        [
            item.get("content", item.get("text", ""))
            for item in history
            if isinstance(item, dict)
            and str(item.get("role", item.get("messageType", ""))).lower() == "user"
        ]
        if isinstance(history, list)
        else []
    )
    current = match_employment_exclusion(pref, job_info, question, recruiter_text)
    words = exclusion_keywords(pref)
    hit = current or next(
        (
            word
            for word in remembered
            if word in words or (word == HUNTER_MARKER and enabled(pref.get("fhE")))
        ),
        None,
    )
    if current and current not in remembered:
        async with db.engine.begin() as connection:
            await db.set_control(connection, uid, control_key, (remembered + [current])[-100:])
    return hit
