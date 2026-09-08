"""Import persisted AI reply sessions as observed career progress."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from ..conversation import safe_history
from ..database import now_ms
from ..outcomes.policy import outcome_signal
from .observations import INTERVIEW_SIGNAL, OFFER_SIGNAL

LOCAL_TIMEZONE = timezone(timedelta(hours=8))


def _milliseconds(value) -> int:
    if isinstance(value, datetime):
        current = value if value.tzinfo else value.replace(tzinfo=LOCAL_TIMEZONE)
        return int(current.timestamp() * 1000)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = int(value)
        return number * 1000 if number < 100_000_000_000 else number
    if isinstance(value, str):
        try:
            return _milliseconds(datetime.fromisoformat(value))
        except ValueError:
            return 0
    return 0


async def _insert_once(store, connection, uid, app, event_type, occurred_at, reference, text):
    key = f"career:legacy-session:{reference}:{event_type}"
    if await store.db.control(uid, key, False, connection):
        return False
    await store.insert_event(
        connection,
        uid,
        app,
        event_type,
        occurred_at,
        {"source": "LEGACY_AI_SESSION", "referenceId": reference, "quote": text},
        "OBSERVED",
    )
    await store.db.set_control(connection, uid, key, True)
    return True


async def import_legacy_sessions(connection, uid, store) -> dict[str, int]:
    """Recover exact HR turns saved by the former Java/Python reply flow.

    Legacy session keys contain the exact BOSS job id and owner id. A session is
    attached only when there is one matching application; otherwise a dedicated
    historical application is created. Ambiguous existing application cycles are
    skipped instead of guessing.
    """

    sessions = store.db.table("msg_session")
    rows = (
        (
            await connection.execute(
                select(sessions)
                .where(
                    sessions.c.user_id == uid,
                    sessions.c.status == 1,
                    sessions.c.is_active.is_(True),
                )
                .order_by(sessions.c.created_date.asc(), sessions.c.id.asc())
            )
        )
        .mappings()
        .all()
    )
    counts = {
        "importedSessionApplications": 0,
        "importedSessionContacts": 0,
        "importedSessionReplies": 0,
        "importedSessionOutcomes": 0,
        "ambiguousSessions": 0,
    }
    for row in rows:
        key = str(row["session_key"] or "")
        if key.startswith("graph:") or ":" not in key:
            continue
        encrypt_job_id, platform_account = key.rsplit(":", 1)
        if not encrypt_job_id or not platform_account.isdigit():
            continue
        history = safe_history(row["msg_context"])
        hr_turns = [item for item in history if item["role"] == "user" and item["content"]]
        if not hr_turns:
            continue
        candidates = (
            (
                await connection.execute(
                    select(store.applications).where(
                        store.applications.c.user_id == uid,
                        store.db.exact(store.applications.c.encrypt_job_id, encrypt_job_id),
                    )
                )
            )
            .mappings()
            .all()
        )
        session_candidates = [
            dict(item)
            for item in candidates
            if str(item["cycle_key"] or "").startswith("legacy-session:")
        ]
        if len(session_candidates) == 1:
            app = session_candidates[0]
        elif len(candidates) == 1:
            app = dict(candidates[0])
        elif candidates:
            counts["ambiguousSessions"] += 1
            continue
        else:
            created_at = _milliseconds(row["created_date"] or row["updated_date"]) or now_ms()
            app, reused = await store.insert_application(
                connection,
                uid,
                platform_account,
                encrypt_job_id,
                f"legacy-session:{encrypt_job_id}",
                {
                    "jobTitle": "历史 AI 回复会话",
                    "jobBaseInfo": "{}",
                    "jobExtInfo": "{}",
                    "capturedResumeContent": "",
                    "capturedPreference": None,
                    "capturedAt": created_at,
                    "exposureNote": "历史会话不证明附件发送",
                },
                created_at=created_at,
            )
            if not reused:
                counts["importedSessionApplications"] += 1
        occurred_at = _milliseconds(row["created_date"] or row["updated_date"]) or app["created_at"]
        if await _insert_once(
            store,
            connection,
            uid,
            app,
            "CONTACT_INITIATED",
            occurred_at,
            f"{row['id']}:contact",
            "已保存该岗位的 AI 回复会话",
        ):
            counts["importedSessionContacts"] += 1
        previous_candidate = None
        user_index = 0
        for item in history:
            if item["role"] == "assistant":
                previous_candidate = item["content"]
                continue
            if item["role"] != "user" or not item["content"]:
                continue
            text = item["content"]
            reference = f"{row['id']}:hr:{user_index}"
            message_at = min(now_ms(), occurred_at + user_index + 1)
            user_index += 1
            if await _insert_once(
                store, connection, uid, app, "HR_REPLIED", message_at, reference, text
            ):
                counts["importedSessionReplies"] += 1
            signal = outcome_signal(text, previous_candidate)
            outcome = None
            if signal == "REJECTED":
                outcome = "REJECTED"
            elif signal == "POSITIVE" and OFFER_SIGNAL.search(text):
                outcome = "OFFER_RECEIVED"
            elif signal == "POSITIVE" and INTERVIEW_SIGNAL.search(text):
                outcome = "INTERVIEW_INVITED"
            if outcome and await _insert_once(
                store, connection, uid, app, outcome, message_at, reference, text
            ):
                counts["importedSessionOutcomes"] += 1
    return counts
