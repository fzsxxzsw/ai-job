from sqlalchemy import select

from ..database import loads, now_ms
from ..errors import ApiError
from ..execution_authority import bump_session_authority
from .storage import TERMINAL, Storage, digest

MANUAL_TAKEOVER_PREFIX = "manual-takeover:"
MANUAL_TAKEOVER_EVENT = "MANUAL_TAKEOVER"
LEGACY_STOP_COMPATIBILITY = "LEGACY_OR_EXPLICIT_STOP_REQUIRES_RESUME"


def manual_takeover_key(job_key: str) -> str:
    return MANUAL_TAKEOVER_PREFIX + job_key


def _same_binding(state, payload) -> bool:
    return all(
        str(state.get(key) or "") == str(value or "")
        for key, value in (
            ("platformAccount", payload.platformAccount),
            ("conversationKey", payload.conversationKey),
            ("encryptJobId", payload.encryptJobId),
            ("bossId", payload.bossId),
            ("jobKey", payload.input.jobKey if hasattr(payload, "input") else payload.jobKey),
        )
    )


async def permanent_pause_status(db, uid, job_key: str, c=None):
    controls = db.table("py_api_control")

    async def row(key):
        value = await db.one(
            select(controls.c.value_json, controls.c.updated_at).where(
                controls.c.user_id == uid, db.exact(controls.c.control_key, key)
            ),
            c,
        )
        if not value:
            return None
        return {"value": loads(value["value_json"], False), "updatedAt": value["updated_at"]}

    global_stop = await row("stop:*")
    session_stop = await row("stop:" + job_key)
    if global_stop and global_stop["value"] is True:
        return {"paused": True, "scope": "GLOBAL", "updatedAt": global_stop["updatedAt"]}
    if session_stop and session_stop["value"] is True:
        return {"paused": True, "scope": "SESSION", "updatedAt": session_stop["updatedAt"]}
    return {"paused": False, "scope": None, "updatedAt": None}


async def active_manual_takeover(db, uid, job_key: str, c=None):
    state = await db.control(uid, manual_takeover_key(job_key), None, c)
    return state if isinstance(state, dict) and state.get("status") == "ACTIVE" else None


async def consume_manual_takeover_for_reply(db, c, uid, payload):
    """Atomically consume a proven-new inbound watermark from Jobs.submit.

    The caller must already own the automation-state transaction. Permanent pause
    always wins and is intentionally not converted because historical stop rows do
    not record whether they came from the old hook, a user, or a safety rule.
    """
    pause = await permanent_pause_status(db, uid, payload.input.jobKey, c)
    state = await active_manual_takeover(db, uid, payload.input.jobKey, c)
    if pause["paused"]:
        return {
            "active": bool(state),
            "consumed": False,
            "permanentPaused": True,
            "compatibility": LEGACY_STOP_COMPATIBILITY,
            "stopUpdatedAt": pause["updatedAt"],
        }
    if not state:
        return {"active": False, "consumed": False, "permanentPaused": False}
    if not _same_binding(state, payload):
        raise ApiError("AUTOMATION_SCOPE_CHANGED", 409)
    if payload.input.inboundMessageId == state.get("throughInboundMessageId"):
        raise ApiError("MANUAL_TAKEOVER_ACTIVE", 409)
    previous_time = state.get("throughInboundSentAt")
    incoming_time = payload.input.inboundSentAt
    if (
        not isinstance(previous_time, int)
        or isinstance(previous_time, bool)
        or not isinstance(incoming_time, int)
        or isinstance(incoming_time, bool)
        or incoming_time <= previous_time
    ):
        raise ApiError("INBOUND_ORDER_UNCERTAIN", 409)
    consumed = {
        **state,
        "status": "CONSUMED",
        "consumedByInboundMessageId": payload.input.inboundMessageId,
        "consumedByInboundSentAt": incoming_time,
        "consumedAt": now_ms(),
    }
    await db.set_control(c, uid, manual_takeover_key(payload.input.jobKey), consumed)
    return {"active": True, "consumed": True, "permanentPaused": False, "state": consumed}


async def _record_manual_turn(service, c, uid, payload):
    """Single integration point for the shared exact conversation-history writer."""
    try:
        from .conversation_history import append_manual_turn
    except ImportError:
        return False
    return bool(
        await append_manual_turn(
            service.db,
            c,
            uid,
            platform_account=payload.platformAccount,
            conversation_key=payload.conversationKey,
            boss_id=payload.bossId,
            encrypt_job_id=payload.encryptJobId,
            inbound_message_id=payload.throughInboundMessageId,
            inbound_sent_at=payload.throughInboundSentAt,
            inbound_text=payload.throughInboundText,
            outbound_message_id=payload.manualOutboundMessageId,
            outbound_client_mid=payload.manualOutboundClientMid,
            outbound_sent_at=payload.manualOutboundSentAt,
            outbound_text=payload.manualText,
            event_id=payload.requestId,
        )
    )


class ManualTakeover(Storage):
    async def status(self, uid, payload):
        await self.account(uid, payload.platformAccount)
        state = await self.db.control(uid, manual_takeover_key(payload.jobKey), None)
        if isinstance(state, dict) and not _same_binding(state, payload):
            raise ApiError("AUTOMATION_SCOPE_CHANGED", 409)
        pause = await permanent_pause_status(self.db, uid, payload.jobKey)
        return {
            "status": state.get("status") if isinstance(state, dict) else None,
            "active": isinstance(state, dict) and state.get("status") == "ACTIVE",
            "permanentPaused": pause["paused"],
            "stopScope": pause["scope"],
            "stopUpdatedAt": pause["updatedAt"],
            "compatibility": LEGACY_STOP_COMPATIBILITY
            if pause["paused"] and (not isinstance(state, dict) or state.get("status") != "ACTIVE")
            else None,
        }

    async def activate(self, uid, payload):
        timestamp = now_ms()
        if payload.manualOutboundSentAt > timestamp + 60_000 or (
            payload.throughInboundSentAt is not None
            and payload.throughInboundSentAt > timestamp + 60_000
        ):
            raise ApiError("INVALID_EVENT_TIME", 422)
        raw = payload.model_dump(mode="json")
        event_payload = {
            key: raw[key]
            for key in (
                "platformAccount",
                "conversationKey",
                "encryptJobId",
                "bossId",
                "jobKey",
                "throughInboundMessageId",
                "throughInboundSentAt",
                "manualOutboundClientMid",
                "manualOutboundMessageId",
                "manualOutboundSentAt",
            )
        }
        event_payload["throughInboundTextHash"] = digest(payload.throughInboundText)
        event_payload["manualTextHash"] = digest(payload.manualText)
        async with self.db.lock(uid, "conversation:" + payload.jobKey):
            async with self.transaction(uid) as c:
                await self.account(uid, payload.platformAccount, c)
                _, replayed = await self.event(
                    c, uid, payload.requestId, MANUAL_TAKEOVER_EVENT, event_payload
                )
                current = await self.db.control(uid, manual_takeover_key(payload.jobKey), None, c)
                if replayed:
                    return {
                        "status": (current or {}).get("status"),
                        "replayed": True,
                        "permanentPaused": (current or {}).get("status") == "PERMANENT_PAUSED",
                        "state": current,
                    }
                history_recorded = await _record_manual_turn(self, c, uid, payload)
                pause = await permanent_pause_status(self.db, uid, payload.jobKey, c)
                if pause["paused"]:
                    state = {
                        "schemaVersion": 1,
                        "status": "PERMANENT_PAUSED",
                        "platformAccount": payload.platformAccount,
                        "conversationKey": payload.conversationKey,
                        "encryptJobId": payload.encryptJobId,
                        "bossId": payload.bossId,
                        "jobKey": payload.jobKey,
                        "throughInboundMessageId": payload.throughInboundMessageId,
                        "throughInboundSentAt": payload.throughInboundSentAt,
                        "activatedByOutboundMessageId": payload.manualOutboundMessageId,
                        "activatedAt": timestamp,
                        "stopScope": pause["scope"],
                        "stopUpdatedAt": pause["updatedAt"],
                        "compatibility": LEGACY_STOP_COMPATIBILITY,
                    }
                    await self.db.set_control(c, uid, manual_takeover_key(payload.jobKey), state)
                    return {
                        "status": state["status"],
                        "replayed": False,
                        "permanentPaused": True,
                        "compatibility": LEGACY_STOP_COMPATIBILITY,
                        "historyRecorded": history_recorded,
                        "state": state,
                    }
                epoch = await bump_session_authority(self.db, c, uid, payload.jobKey)
                state = {
                    "schemaVersion": 1,
                    "status": "ACTIVE",
                    "platformAccount": payload.platformAccount,
                    "conversationKey": payload.conversationKey,
                    "encryptJobId": payload.encryptJobId,
                    "bossId": payload.bossId,
                    "jobKey": payload.jobKey,
                    "throughInboundMessageId": payload.throughInboundMessageId,
                    "throughInboundSentAt": payload.throughInboundSentAt,
                    "activatedByOutboundMessageId": payload.manualOutboundMessageId,
                    "authorityEpoch": epoch,
                    "activatedAt": timestamp,
                }
                await self.db.set_control(c, uid, manual_takeover_key(payload.jobKey), state)
                active = (
                    (
                        await c.execute(
                            select(self.jobs).where(
                                self.jobs.c.user_id == uid,
                                self.jobs.c.kind == "REPLY",
                                self.db.exact(
                                    self.jobs.c.platform_account, payload.platformAccount
                                ),
                                self.db.exact(
                                    self.jobs.c.conversation_key, payload.conversationKey
                                ),
                                self.jobs.c.status.notin_(TERMINAL),
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                for row in active:
                    await self.close_pending(c, uid, dict(row), "MANUAL_TAKEOVER")
                return {
                    "status": state["status"],
                    "replayed": False,
                    "permanentPaused": False,
                    "historyRecorded": history_recorded,
                    "cancelledJobCount": len(active),
                    "state": state,
                }
