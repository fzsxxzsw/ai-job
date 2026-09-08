"""Facts derived from authenticated ACKs and exact, unambiguous conversation observations."""

import re

from sqlalchemy import select

from ..automation.storage import digest
from ..database import loads
from .applications import Applications, effective_events


async def matched_application(store, c, uid, encrypt_job_id, conversation, boss, account=None):
    if not conversation or not boss:
        return None
    table = store.applications
    conditions = [
        table.c.user_id == uid,
        store.db.exact(table.c.encrypt_job_id, encrypt_job_id),
        store.db.exact(table.c.conversation_key, conversation),
        store.db.exact(table.c.boss_id, boss),
    ]
    if account is not None:
        conditions.append(store.db.exact(table.c.platform_account, account))
    rows = (await c.execute(select(table).where(*conditions).limit(2))).mappings().all()
    # Multiple application cycles require a human association, never a latest-row guess.
    if len(rows) == 1:
        return dict(rows[0])
    if rows:
        return None

    # Contact ACKs can precede the first reliable BOSS conversation binding. Bind
    # a later observation only when exactly one contacted application can own it.
    fallback = [
        table.c.user_id == uid,
        store.db.exact(table.c.encrypt_job_id, encrypt_job_id),
    ]
    if account is not None:
        fallback.append(store.db.exact(table.c.platform_account, account))
    candidates = (await c.execute(select(table).where(*fallback).limit(3))).mappings().all()
    eligible = []
    for candidate in candidates:
        if candidate["conversation_key"] not in {None, conversation} or candidate[
            "boss_id"
        ] not in {None, boss}:
            continue
        timeline = await store.timeline(uid, candidate["id"], c)
        if any(
            event["event_type"] == "CONTACT_INITIATED" and event["confirmation"] != "INFERRED"
            for event in effective_events(timeline)
        ):
            eligible.append(dict(candidate))
    if len(eligible) != 1:
        return None
    app = eligible[0]
    await c.execute(
        table.update()
        .where(table.c.id == app["id"], table.c.user_id == uid)
        .values(conversation_key=conversation, boss_id=boss)
    )
    return {**app, "conversation_key": conversation, "boss_id": boss}


async def record_ack(service, c, uid, job, action, occurred_at):
    if not service.settings.career_enabled or action["status"] != "ACKNOWLEDGED":
        return
    store = Applications(service.db, service.settings)
    key = "career:ack:" + action["id"]
    if await service.db.control(uid, key, False, c):
        return
    raw = loads(job["input_json"], {}).get("input", {})
    payload = loads(action["payload_json"], {})
    bundle = loads(job["context_json"], {})
    if action["kind"] == "CONTACT_JOB":
        filter_input = raw["filterInput"]
        base = loads(filter_input["jobBaseInfo"], {})
        career = bundle.get("career", {})
        app, _ = await store.insert_application(
            c,
            uid,
            job["platform_account"],
            job["encrypt_job_id"],
            raw["cycleKey"],
            {
                "jobTitle": str(base.get("jobName") or base.get("jobTitle") or "")[:200],
                "jobBaseInfo": filter_input["jobBaseInfo"],
                "jobExtInfo": filter_input["jobExtInfo"],
                "jobGroup": career.get("allocationGroup"),
                "capturedResumeContent": (bundle.get("resume") or {}).get("resume_content"),
                "capturedPreference": bundle["preference"],
            },
            conversation=job["conversation_key"],
            boss=job["boss_id"],
            job_id=job["id"],
            prepared=career.get("preparedResumeVersionId"),
            strategy=career.get("strategyPlanId"),
        )
        await store.insert_event(
            c,
            uid,
            app,
            "CONTACT_INITIATED",
            occurred_at,
            {"source": "PLATFORM_ACK", "referenceId": action["id"], "quote": "平台已确认发起沟通"},
            "OBSERVED",
        )
    elif action["kind"] in {"SEND_RESUME", "ACCEPT_RESUME"}:
        app = await matched_application(
            store,
            c,
            uid,
            job["encrypt_job_id"],
            job["conversation_key"],
            job["boss_id"],
            job["platform_account"],
        )
        if not app:
            return
        await store.insert_event(
            c,
            uid,
            app,
            "RESUME_SENT",
            occurred_at,
            {
                "source": "PLATFORM_ACK",
                "referenceId": action["id"],
                "quote": "平台确认发送指定附件，文件内容版本尚未核实",
                "platformResumeId": payload["platformResumeId"],
            },
            "OBSERVED",
        )
    else:
        return
    await service.db.set_control(c, uid, key, True)


async def record_binding(service, c, uid, job):
    if not service.settings.career_enabled:
        return
    table = service.db.table("career_application")
    await c.execute(
        table.update()
        .where(
            table.c.user_id == uid,
            table.c.job_id == job["id"],
            service.db.exact(table.c.platform_account, job["platform_account"]),
        )
        .values(conversation_key=job["conversation_key"], boss_id=job["boss_id"])
    )


async def record_observations(service, c, uid, observations):
    if not service.settings.career_enabled:
        return
    store = Applications(service.db, service.settings)
    # Serialize with action receipts; all cross-module transitions acquire owner before facts.
    users = service.db.table("user_info")
    await c.scalar(select(users.c.id).where(users.c.id == uid).with_for_update())
    for item in observations:
        app = await matched_application(
            store, c, uid, item.encryptJobId, item.conversationKey, item.bossId
        )
        if not app:
            continue
        events = effective_events(
            [e for e in await store.timeline(uid, app["id"], c) if e["confirmation"] != "INFERRED"]
        )
        contacts = [e["occurred_at"] for e in events if e["event_type"] == "CONTACT_INITIATED"]
        if not contacts:
            continue
        for message in item.messages:
            if message.role != "HR" or not message.sentAt or message.sentAt < min(contacts):
                continue
            identity = digest([app["id"], message.messageId])
            key = "career:message:" + identity
            if await service.db.control(uid, key, False, c):
                continue
            await store.insert_event(
                c,
                uid,
                app,
                "HR_REPLIED",
                message.sentAt,
                {"source": item.source, "referenceId": message.messageId, "quote": message.text},
                "OBSERVED",
            )
            await service.db.set_control(c, uid, key, True)


INTERVIEW_SIGNAL = re.compile(
    r"面试|笔试|测评|到公司|来公司|现场聊|线下面谈|视频面谈|面谈时间|面试时间"
)
OFFER_SIGNAL = re.compile(
    r"(?:发|给|收到|确认).{0,8}offer|录用通知|决定录用|办理入职|入职时间", re.I
)


async def _insert_once(service, store, c, uid, app, event_type, occurred_at, message):
    identity = digest([app["id"], event_type, message["messageId"]])
    key = "career:outcome:" + identity
    if await service.db.control(uid, key, False, c):
        return
    await store.insert_event(
        c,
        uid,
        app,
        event_type,
        occurred_at,
        {
            "source": "OUTCOME_REPORT",
            "referenceId": message["messageId"],
            "quote": message["text"],
        },
        "OBSERVED",
    )
    await service.db.set_control(c, uid, key, True)


async def record_outcome_report(service, c, uid, case, report):
    """Project a validated LangGraph report into the career timeline idempotently."""
    if not service.settings.career_enabled:
        return
    store = Applications(service.db, service.settings)
    app = await matched_application(
        store,
        c,
        uid,
        case["encrypt_job_id"],
        case["conversation_key"],
        case["boss_id"],
    )
    if not app:
        return
    events = effective_events(
        [
            event
            for event in await store.timeline(uid, app["id"], c)
            if event["confirmation"] != "INFERRED"
        ]
    )
    contacts = [
        event["occurred_at"] for event in events if event["event_type"] == "CONTACT_INITIATED"
    ]
    if not contacts:
        return
    contact_at = min(contacts)
    facts = loads(case["facts_json"], {})
    messages = sorted(
        (
            message
            for message in facts.get("messages", [])
            if message.get("role") == "HR"
            and message.get("text")
            and (message.get("sentAt") or message.get("observedAt") or 0) >= contact_at
        ),
        key=lambda message: (
            message.get("sentAt") or message.get("observedAt") or 0,
            message["messageId"],
        ),
    )
    for message in messages:
        occurred_at = message.get("sentAt") or message.get("observedAt")
        await _insert_once(service, store, c, uid, app, "HR_REPLIED", occurred_at, message)

    result = loads(report["report_json"], {})
    evidence_ids = {
        item.get("messageId")
        for item in result.get("evidence", [])
        if item.get("role") == "HR" and item.get("messageId")
    }
    evidence = [message for message in messages if message["messageId"] in evidence_ids]
    if not evidence:
        return
    message = evidence[-1]
    occurred_at = message.get("sentAt") or message.get("observedAt")
    if result.get("outcome") == "REJECTED":
        await _insert_once(service, store, c, uid, app, "REJECTED", occurred_at, message)
    elif result.get("outcome") == "POSITIVE":
        if OFFER_SIGNAL.search(message["text"]):
            await _insert_once(service, store, c, uid, app, "OFFER_RECEIVED", occurred_at, message)
        elif INTERVIEW_SIGNAL.search(message["text"]):
            await _insert_once(
                service, store, c, uid, app, "INTERVIEW_INVITED", occurred_at, message
            )
