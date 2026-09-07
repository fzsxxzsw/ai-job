from sqlalchemy import select

from ..contracts import AskInput
from ..conversation import safe_history
from ..database import dumps, loads, now_date
from .history import current_rounds, history_key


async def acknowledge_text(service, c, uid, job, action):
    """Record real ACKs even when the originating job was cancelled/superseded."""
    if (
        action["kind"] not in {"SEND_TEXT", "SEND_GREETING"}
        or action["status"] != "ACKNOWLEDGED"
        or action["finalized"]
    ):
        return False
    raw = loads(job["input_json"], {})
    greeting = action["kind"] == "SEND_GREETING"
    if greeting:
        if not job["conversation_key"] or not job["boss_id"]:
            return False
        raw.update(platformAccount=job["platform_account"], conversationKey=job["conversation_key"])
    input_ = raw["input"]
    key = history_key(raw)
    sessions = service.db.table("msg_session")
    session = await service.db.one(
        select(sessions)
        .where(
            sessions.c.user_id == uid,
            service.db.exact(sessions.c.session_key, key),
            sessions.c.is_active.is_(True),
            sessions.c.status == 1,
        )
        .order_by(sessions.c.id.desc())
        .limit(1),
        c,
    )
    history = safe_history(session["msg_context"]) if session else []
    text = loads(action["payload_json"], {})["text"]
    new_history = (
        history
        + ([] if greeting else [{"role": "user", "content": input_["question"]}])
        + [{"role": "assistant", "content": text}]
    )[-20:]
    while len(dumps(new_history).encode()) > 60000 and len(new_history) > 2:
        new_history = new_history[2:]
    values = {
        "msg_context": dumps(new_history),
        "ai_type": 1,
        "updated_id": uid,
        "updated_date": now_date(),
    }
    if session:
        await c.execute(
            sessions.update()
            .where(sessions.c.user_id == uid, sessions.c.id == session["id"])
            .values(**values)
        )
    else:
        await c.execute(
            sessions.insert().values(
                **values,
                user_id=uid,
                session_key=key,
                status=1,
                is_active=True,
                created_id=uid,
                created_date=now_date(),
            )
        )
    if not greeting:
        rounds, reset = await current_rounds(service.db, uid, raw, c)
        await service.db.set_control(c, uid, "chat-rounds:" + key, rounds + 1)
        await service.db.set_control(c, uid, "graph-round-applied:" + key, reset)
    await service.update_action(c, action, finalized=1)
    return not greeting


async def notify_ack(service, uid, job, action):
    if service.notifier is None or action["kind"] != "SEND_TEXT":
        return
    raw = loads(job["input_json"], {})["input"]
    payload = AskInput(question=raw["question"], jobKey=raw["jobKey"], jobInfo=raw.get("jobInfo"))
    await service.notifier.notify_conversation(
        service.db,
        uid,
        payload,
        loads(action["payload_json"], {})["text"],
        high_interest=loads(job["artifact_json"], {}).get("highInterest", False),
        event_key="action:" + action["id"],
    )
