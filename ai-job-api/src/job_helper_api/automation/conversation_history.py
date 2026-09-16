"""Canonical, conversation-scoped message history.

Only messages with a real server message id are admitted.  Client ids are
aliases, never primary identity, so a local echo cannot become model truth
before the platform confirms it.
"""

from __future__ import annotations

import hashlib
from typing import Any
from uuid import uuid4

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError

from ..database import dumps, loads, now_ms
from ..errors import ApiError

HISTORY_LIMIT = 16
HISTORY_MAX_BYTES = 60_000
MIGRATION_MARKER = "migration:conversation-history-v2"

_AUTHOR_KINDS = {"HR", "HUMAN", "AI", "UNKNOWN"}
_ROLES = {"HR", "USER"}
_DELIVERY_RANK = {"OBSERVED": 0, "ACKNOWLEDGED": 1}
_ORDER_RANK = {"OBSERVED": 0, "ACK": 1, "PLATFORM": 2}


def _sha(value: Any) -> str:
    return hashlib.sha256(dumps(value).encode("utf-8")).hexdigest()


def _required(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"EXACT_{name.upper()}_REQUIRED", 422)
    return value


def _positive_decimal(value: Any) -> bool:
    return isinstance(value, str) and value.isascii() and value.isdigit() and int(value) > 0


def conversation_id(
    platform_account: str,
    conversation_key: str,
    boss_id: str,
    encrypt_job_id: str,
) -> str:
    """Return the exact binding digest used as the conversation boundary."""
    binding = [
        "boss",
        _required(platform_account, "platform_account"),
        _required(conversation_key, "conversation_key"),
        _required(boss_id, "boss_id"),
        _required(encrypt_job_id, "encrypt_job_id"),
    ]
    return _sha(binding)


def _value(item: Any, name: str, default=None):
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _source_values(raw: Any) -> list[str]:
    values = loads(raw, [])
    if not isinstance(values, list):
        return []
    return [str(value)[:192] for value in values if isinstance(value, str) and value][:32]


def _merged_sources(raw: Any, source: str) -> str:
    values = _source_values(raw)
    source = _required(source, "source")[:192]
    if source not in values:
        values.append(source)
    return dumps(values[-32:])


def _validate_message(
    *, message_id: str, client_mid: str | None, role: str, author_kind: str, text: str
) -> tuple[str, str | None, str, str, str]:
    message_id = _required(message_id, "server_mid")
    if not _positive_decimal(message_id):
        raise ApiError("EXACT_SERVER_MID_REQUIRED", 422)
    if client_mid is not None:
        client_mid = _required(client_mid, "client_mid")
        if not _positive_decimal(client_mid):
            raise ApiError("EXACT_CLIENT_MID_REQUIRED", 422)
        if client_mid == message_id:
            raise ApiError("MESSAGE_ALIAS_CONFLICT", 409)
    if role not in _ROLES or author_kind not in _AUTHOR_KINDS:
        raise ApiError("INVALID_CONVERSATION_MESSAGE", 422)
    if role == "HR" and author_kind != "HR":
        raise ApiError("INVALID_CONVERSATION_AUTHOR", 422)
    if role == "USER" and author_kind == "HR":
        raise ApiError("INVALID_CONVERSATION_AUTHOR", 422)
    if not isinstance(text, str):
        raise ApiError("INVALID_CONVERSATION_TEXT", 422)
    return message_id, client_mid, role, author_kind, text


async def _matching_rows(db, c, uid: int, cid: str, message_id: str, client_mid: str | None):
    table = db.table("conversation_message")
    identities = [db.exact(table.c.message_id, message_id)]
    if client_mid:
        identities.append(db.exact(table.c.client_mid, client_mid))
    statement = (
        select(table)
        .where(
            table.c.user_id == uid,
            table.c.conversation_id == cid,
            or_(*identities),
        )
        .with_for_update()
    )
    return [dict(row) for row in (await c.execute(statement)).mappings()]


async def _causal_values(
    db,
    c,
    uid: int,
    cid: str,
    message_id: str,
    causal_after_message_id: str | None,
    order_at: int,
) -> tuple[str | None, str, int]:
    if causal_after_message_id is None:
        return None, message_id, 0
    causal_after_message_id = _required(causal_after_message_id, "causal_after_message_id")
    if not _positive_decimal(causal_after_message_id):
        raise ApiError("EXACT_CAUSAL_MID_REQUIRED", 422)
    if causal_after_message_id == message_id:
        raise ApiError("CONVERSATION_CAUSAL_CONFLICT", 409)
    table = db.table("conversation_message")
    predecessor = (
        (
            await c.execute(
                select(table)
                .where(
                    table.c.user_id == uid,
                    table.c.conversation_id == cid,
                    db.exact(table.c.message_id, causal_after_message_id),
                )
                .with_for_update()
            )
        )
        .mappings()
        .first()
    )
    if not predecessor:
        raise ApiError("CONVERSATION_CAUSAL_PREDECESSOR_MISSING", 409)
    if order_at < predecessor["order_at"]:
        raise ApiError("CONVERSATION_CAUSAL_TIME_CONFLICT", 409)
    root = predecessor["causal_root_message_id"] or predecessor["message_id"]
    if root == message_id:
        raise ApiError("CONVERSATION_CAUSAL_CONFLICT", 409)
    return causal_after_message_id, root, int(predecessor["causal_depth"] or 0) + 1


async def _rebase_descendants(db, c, uid: int, cid: str, parent: dict) -> None:
    """Keep materialized roots/depths aligned after adding a legacy edge."""
    table = db.table("conversation_message")
    pending = [parent]
    visited = {parent["message_id"]}
    while pending:
        predecessor = pending.pop(0)
        children = (
            (
                await c.execute(
                    select(table)
                    .where(
                        table.c.user_id == uid,
                        table.c.conversation_id == cid,
                        db.exact(table.c.causal_after_message_id, predecessor["message_id"]),
                    )
                    .with_for_update()
                )
            )
            .mappings()
            .all()
        )
        for raw in children:
            child = dict(raw)
            if child["message_id"] in visited or child["order_at"] < predecessor["order_at"]:
                raise ApiError("CONVERSATION_CAUSAL_CONFLICT", 409)
            visited.add(child["message_id"])
            if len(visited) > 1000:
                raise ApiError("CONVERSATION_CAUSAL_CONFLICT", 409)
            values = {
                "causal_root_message_id": predecessor["causal_root_message_id"],
                "causal_depth": int(predecessor["causal_depth"]) + 1,
                "updated_at": now_ms(),
            }
            if any(child[key] != value for key, value in values.items() if key != "updated_at"):
                await c.execute(table.update().where(table.c.id == child["id"]).values(**values))
                child.update(values)
            pending.append(child)


async def _latest_confirmed_outbound(db, c, uid: int, cid: str, *, not_after: int) -> str | None:
    """Return one causally latest confirmed USER message without using opaque MIDs."""
    table = db.table("conversation_message")
    base = and_(
        table.c.user_id == uid,
        table.c.conversation_id == cid,
        table.c.role == "USER",
        table.c.delivery_state == "ACKNOWLEDGED",
        table.c.order_at <= not_after,
    )
    latest_order = await c.scalar(select(func.max(table.c.order_at)).where(base))
    if latest_order is None:
        return None
    latest_observed = await c.scalar(
        select(func.max(table.c.observed_at)).where(base, table.c.order_at == latest_order)
    )
    rows = [
        dict(row)
        for row in (
            await c.execute(
                select(table)
                .where(
                    base,
                    table.c.order_at == latest_order,
                    table.c.observed_at == latest_observed,
                )
                .with_for_update()
            )
        ).mappings()
    ]
    roots = {row["causal_root_message_id"] or row["message_id"] for row in rows}
    if len(roots) != 1:
        return None
    deepest = max(int(row["causal_depth"] or 0) for row in rows)
    candidates = [row for row in rows if int(row["causal_depth"] or 0) == deepest]
    return candidates[0]["message_id"] if len(candidates) == 1 else None


def _merged_values(existing: dict, incoming: dict) -> dict:
    exact = ("platform_account", "conversation_key", "boss_id", "encrypt_job_id")
    if any(existing[name] != incoming[name] for name in exact):
        raise ApiError("CONVERSATION_BINDING_CONFLICT", 409)
    if existing["message_id"] != incoming["message_id"]:
        raise ApiError("MESSAGE_ALIAS_CONFLICT", 409)
    if existing["role"] != incoming["role"]:
        raise ApiError("CONVERSATION_ROLE_CONFLICT", 409)
    if existing["client_mid"] and incoming["client_mid"]:
        if existing["client_mid"] != incoming["client_mid"]:
            raise ApiError("MESSAGE_ALIAS_CONFLICT", 409)
    if existing["text"] and incoming["text"]:
        if existing["text_hash"] != incoming["text_hash"]:
            raise ApiError("CONVERSATION_TEXT_CONFLICT", 409)

    author = existing["author_kind"]
    incoming_author = incoming["author_kind"]
    if author == "UNKNOWN" and incoming_author != "UNKNOWN":
        author = incoming_author
    elif incoming_author != "UNKNOWN" and author != incoming_author:
        raise ApiError("CONVERSATION_AUTHOR_CONFLICT", 409)

    delivery = existing["delivery_state"]
    if _DELIVERY_RANK[incoming["delivery_state"]] > _DELIVERY_RANK[delivery]:
        delivery = incoming["delivery_state"]

    confidence = existing["order_confidence"]
    order_at = existing["order_at"]
    if _ORDER_RANK[incoming["order_confidence"]] > _ORDER_RANK[confidence]:
        confidence = incoming["order_confidence"]
        order_at = incoming["order_at"]

    existing_after = existing["causal_after_message_id"]
    incoming_after = incoming["causal_after_message_id"]
    if existing_after and incoming_after and existing_after != incoming_after:
        raise ApiError("CONVERSATION_CAUSAL_CONFLICT", 409)
    if existing_after:
        if (
            existing["causal_root_message_id"] != incoming["causal_root_message_id"]
            or existing["causal_depth"] != incoming["causal_depth"]
        ):
            raise ApiError("CONVERSATION_CAUSAL_CONFLICT", 409)
        causal_root = existing["causal_root_message_id"]
        causal_depth = existing["causal_depth"]
    else:
        causal_root = incoming["causal_root_message_id"]
        causal_depth = incoming["causal_depth"]

    text = existing["text"] or incoming["text"]
    values = dict(
        client_mid=existing["client_mid"] or incoming["client_mid"],
        author_kind=author,
        text=text,
        text_hash=_sha(text),
        sent_at=existing["sent_at"] or incoming["sent_at"],
        observed_at=min(existing["observed_at"], incoming["observed_at"]),
        order_at=order_at,
        order_confidence=confidence,
        causal_after_message_id=existing_after or incoming_after,
        causal_root_message_id=causal_root,
        causal_depth=causal_depth,
        delivery_state=delivery,
        model_eligible=max(existing["model_eligible"], incoming["model_eligible"]),
        sources_json=_merged_sources(existing["sources_json"], incoming["source"]),
        updated_at=incoming["updated_at"],
    )
    return values


async def upsert_message(
    db,
    c,
    uid: int,
    *,
    platform_account: str,
    conversation_key: str,
    boss_id: str,
    encrypt_job_id: str,
    message_id: str,
    client_mid: str | None,
    role: str,
    author_kind: str,
    text: str,
    sent_at: int | None,
    observed_at: int | None,
    delivery_state: str,
    order_confidence: str,
    source: str,
    model_eligible: bool = True,
    causal_after_message_id: str | None = None,
) -> dict:
    """Insert or monotonically enrich one exact server message."""
    message_id, client_mid, role, author_kind, text = _validate_message(
        message_id=message_id,
        client_mid=client_mid,
        role=role,
        author_kind=author_kind,
        text=text,
    )
    if delivery_state not in _DELIVERY_RANK or order_confidence not in _ORDER_RANK:
        raise ApiError("INVALID_CONVERSATION_EVIDENCE", 422)
    timestamp = now_ms()
    observed_at = observed_at if observed_at is not None else (sent_at or timestamp)
    if (
        not isinstance(observed_at, int)
        or observed_at <= 0
        or (sent_at is not None and (not isinstance(sent_at, int) or sent_at <= 0))
    ):
        raise ApiError("INVALID_EVENT_TIME", 422)
    cid = conversation_id(platform_account, conversation_key, boss_id, encrypt_job_id)
    order_at = sent_at or observed_at
    incoming = dict(
        id=str(uuid4()),
        user_id=uid,
        conversation_id=cid,
        platform_account=platform_account,
        conversation_key=conversation_key,
        boss_id=boss_id,
        encrypt_job_id=encrypt_job_id,
        message_id=message_id,
        client_mid=client_mid,
        role=role,
        author_kind=author_kind,
        text=text,
        text_hash=_sha(text),
        sent_at=sent_at,
        observed_at=observed_at,
        order_at=order_at,
        order_confidence=order_confidence,
        causal_after_message_id=None,
        causal_root_message_id=message_id,
        causal_depth=0,
        delivery_state=delivery_state,
        model_eligible=int(bool(model_eligible and text.strip())),
        sources_json=dumps([_required(source, "source")[:192]]),
        source=source,
        created_at=timestamp,
        updated_at=timestamp,
    )
    rows = await _matching_rows(db, c, uid, cid, message_id, client_mid)
    if len(rows) > 1:
        raise ApiError("MESSAGE_ALIAS_CONFLICT", 409)
    existing_after = rows[0]["causal_after_message_id"] if rows else None
    if existing_after and causal_after_message_id and existing_after != causal_after_message_id:
        raise ApiError("CONVERSATION_CAUSAL_CONFLICT", 409)
    effective_after = existing_after or causal_after_message_id
    effective_order_at = order_at
    if rows and _ORDER_RANK[rows[0]["order_confidence"]] >= _ORDER_RANK[order_confidence]:
        effective_order_at = rows[0]["order_at"]
    causal_after, causal_root, causal_depth = await _causal_values(
        db,
        c,
        uid,
        cid,
        message_id,
        effective_after,
        effective_order_at,
    )
    incoming.update(
        causal_after_message_id=causal_after,
        causal_root_message_id=causal_root,
        causal_depth=causal_depth,
    )
    table = db.table("conversation_message")
    if not rows:
        values = {key: value for key, value in incoming.items() if key != "source"}
        dialect = db.engine.dialect.name
        if dialect == "mysql":
            statement = mysql_insert(table).values(**values).on_duplicate_key_update(id=table.c.id)
            await c.execute(statement)
        elif dialect == "sqlite":
            await c.execute(sqlite_insert(table).values(**values).on_conflict_do_nothing())
        else:
            try:
                async with c.begin_nested():
                    await c.execute(table.insert().values(**values))
            except IntegrityError:
                pass
        rows = await _matching_rows(db, c, uid, cid, message_id, client_mid)
        if not rows:
            raise ApiError("CONVERSATION_MESSAGE_WRITE_FAILED", 409)
        if rows[0]["id"] == values["id"]:
            return {**values, "created": True, "changed": True}
    existing = rows[0]
    values = _merged_values(existing, incoming)
    causal_changed = any(
        existing.get(key) != values[key]
        for key in (
            "order_at",
            "causal_after_message_id",
            "causal_root_message_id",
            "causal_depth",
        )
    )
    changed = any(
        existing.get(key) != value for key, value in values.items() if key != "updated_at"
    )
    if changed:
        await c.execute(
            table.update()
            .where(table.c.id == existing["id"], table.c.user_id == uid)
            .values(**values)
        )
        if causal_changed:
            await _rebase_descendants(db, c, uid, cid, {**existing, **values})
    else:
        values["updated_at"] = existing["updated_at"]
    return {**existing, **values, "created": False, "changed": changed}


async def project_observations(
    db, c, uid: int, observations, *, platform_account: str | None = None
) -> dict:
    """Project exact observation messages without coupling model history to outcome JSON."""
    stats = {"inserted": 0, "updated": 0, "skipped": 0}
    if not platform_account:
        owner = await db.user(uid, c)
        platform_account = (owner or {}).get("unique_id")
    for observation in observations:
        binding = dict(
            platform_account=_value(observation, "platformAccount", "") or platform_account or "",
            conversation_key=_value(observation, "conversationKey"),
            boss_id=_value(observation, "bossId"),
            encrypt_job_id=_value(observation, "encryptJobId"),
        )
        if not all(binding.values()):
            stats["skipped"] += len(_value(observation, "messages", []) or [])
            continue
        source = _value(observation, "source")
        observed_at = _value(observation, "observedAt")
        previous_snapshot_mid = None
        for message in _value(observation, "messages", []) or []:
            message_id = _value(message, "messageId")
            client_mid = _value(message, "clientMessageId")
            if (
                not _positive_decimal(message_id)
                or (client_mid is not None and not _positive_decimal(client_mid))
                or client_mid == message_id
            ):
                stats["skipped"] += 1
                continue
            role = _value(message, "role")
            sent_at = _value(message, "sentAt")
            delivery = _value(message, "deliveryState", "UNKNOWN")
            row = await upsert_message(
                db,
                c,
                uid,
                **binding,
                message_id=message_id,
                client_mid=client_mid,
                role=role,
                author_kind="HR" if role == "HR" else "UNKNOWN",
                text=_value(message, "text", ""),
                sent_at=sent_at,
                observed_at=observed_at,
                delivery_state="ACKNOWLEDGED" if delivery == "ACKNOWLEDGED" else "OBSERVED",
                order_confidence="PLATFORM"
                if sent_at
                else ("ACK" if delivery == "ACKNOWLEDGED" else "OBSERVED"),
                source="OUTCOME:" + str(source),
                causal_after_message_id=previous_snapshot_mid
                if source == "BOSS_CONVERSATION_SNAPSHOT"
                else None,
            )
            if source == "BOSS_CONVERSATION_SNAPSHOT":
                previous_snapshot_mid = message_id
            if row["created"]:
                stats["inserted"] += 1
            elif row["changed"]:
                stats["updated"] += 1
            else:
                stats["skipped"] += 1
    return stats


async def record_inbound_job(db, c, uid: int, payload) -> dict:
    """Persist the current REPLY inbound before its immutable context is frozen."""
    input_ = payload.input
    from .manual_takeover import manual_takeover_key

    takeover = await db.control(uid, manual_takeover_key(input_.jobKey), None, c)
    causal_after = None
    observed_at = input_.inboundSentAt or now_ms()
    cid = conversation_id(
        payload.platformAccount,
        payload.conversationKey,
        payload.bossId,
        payload.encryptJobId,
    )
    if (
        isinstance(takeover, dict)
        and takeover.get("status") == "CONSUMED"
        and takeover.get("consumedByInboundMessageId") == input_.inboundMessageId
        and all(
            str(takeover.get(key) or "") == str(value or "")
            for key, value in (
                ("platformAccount", payload.platformAccount),
                ("conversationKey", payload.conversationKey),
                ("bossId", payload.bossId),
                ("encryptJobId", payload.encryptJobId),
            )
        )
    ):
        causal_after = takeover.get("activatedByOutboundMessageId")
    if causal_after is None:
        table = db.table("conversation_message")
        existing_parent = await c.scalar(
            select(table.c.causal_after_message_id).where(
                table.c.user_id == uid,
                table.c.conversation_id == cid,
                db.exact(table.c.message_id, input_.inboundMessageId),
            )
        )
        if existing_parent is None:
            causal_after = await _latest_confirmed_outbound(
                db,
                c,
                uid,
                cid,
                not_after=input_.inboundSentAt or observed_at,
            )
    return await upsert_message(
        db,
        c,
        uid,
        platform_account=payload.platformAccount,
        conversation_key=payload.conversationKey,
        boss_id=payload.bossId,
        encrypt_job_id=payload.encryptJobId,
        message_id=input_.inboundMessageId,
        client_mid=None,
        role="HR",
        author_kind="HR",
        text=input_.question,
        sent_at=input_.inboundSentAt,
        observed_at=observed_at,
        delivery_state="OBSERVED",
        order_confidence="PLATFORM" if input_.inboundSentAt else "OBSERVED",
        source="AUTOMATION_JOB",
        causal_after_message_id=causal_after,
    )


async def freeze_recent(
    db,
    c,
    uid: int,
    *,
    platform_account: str,
    conversation_key: str,
    boss_id: str,
    encrypt_job_id: str,
    exclude_message_id: str | None = None,
    limit: int = HISTORY_LIMIT,
    max_bytes: int = HISTORY_MAX_BYTES,
) -> dict:
    """Freeze a bounded, exact-conversation snapshot for one model request."""
    cid = conversation_id(platform_account, conversation_key, boss_id, encrypt_job_id)
    table = db.table("conversation_message")
    where = and_(
        table.c.user_id == uid,
        table.c.conversation_id == cid,
        table.c.model_eligible == 1,
    )
    if exclude_message_id:
        where = and_(where, table.c.message_id != exclude_message_id)
    rows = list(
        (
            await c.execute(
                select(table)
                .where(where)
                .order_by(
                    table.c.order_at.desc(),
                    func.length(table.c.causal_root_message_id).desc(),
                    table.c.causal_root_message_id.desc(),
                    table.c.causal_depth.desc(),
                    func.length(table.c.message_id).desc(),
                    table.c.message_id.desc(),
                )
                .limit(max(1, min(int(limit), 40)))
            )
        ).mappings()
    )
    rows.reverse()
    history = [
        {
            "role": "user" if row["role"] == "HR" else "assistant",
            "content": row["text"][:5000],
        }
        for row in rows
    ]
    while history and len(dumps(history).encode("utf-8")) > max_bytes:
        rows.pop(0)
        history.pop(0)
    fingerprint = [
        [
            row["message_id"],
            row["role"],
            row["author_kind"],
            row["text_hash"],
            row["order_at"],
            row["causal_after_message_id"],
            row["causal_root_message_id"],
            row["causal_depth"],
        ]
        for row in rows
    ]
    return {
        "conversationId": cid,
        "history": history,
        "historyMessageIds": [row["message_id"] for row in rows],
        "historyHash": _sha(fingerprint),
        "historyOrderConfidence": [row["order_confidence"] for row in rows],
        "historyCausalAfterMessageIds": [row["causal_after_message_id"] for row in rows],
        "historyCausalDepths": [row["causal_depth"] for row in rows],
    }


async def freeze_for_reply(db, c, uid: int, payload, **limits) -> dict:
    """Jobs.freeze integration API; excludes the current inbound from prior history."""
    return await freeze_recent(
        db,
        c,
        uid,
        platform_account=payload.platformAccount,
        conversation_key=payload.conversationKey,
        boss_id=payload.bossId,
        encrypt_job_id=payload.encryptJobId,
        exclude_message_id=payload.input.inboundMessageId,
        **limits,
    )


async def append_manual_turn(
    db,
    c,
    uid: int,
    *,
    platform_account: str,
    conversation_key: str,
    boss_id: str,
    encrypt_job_id: str,
    inbound_message_id: str,
    inbound_sent_at: int | None,
    inbound_text: str,
    outbound_message_id: str,
    outbound_client_mid: str | None,
    outbound_sent_at: int | None,
    outbound_text: str,
    event_id: str,
) -> bool:
    """Atomically append an exact HR/HUMAN pair inside the caller's transaction."""
    source = "MANUAL_TURN:" + _required(event_id, "event_id")
    inbound = await upsert_message(
        db,
        c,
        uid,
        platform_account=platform_account,
        conversation_key=conversation_key,
        boss_id=boss_id,
        encrypt_job_id=encrypt_job_id,
        message_id=inbound_message_id,
        client_mid=None,
        role="HR",
        author_kind="HR",
        text=inbound_text,
        sent_at=inbound_sent_at,
        observed_at=inbound_sent_at or outbound_sent_at,
        delivery_state="OBSERVED",
        order_confidence="PLATFORM" if inbound_sent_at else "OBSERVED",
        source=source,
    )
    outbound = await upsert_message(
        db,
        c,
        uid,
        platform_account=platform_account,
        conversation_key=conversation_key,
        boss_id=boss_id,
        encrypt_job_id=encrypt_job_id,
        message_id=outbound_message_id,
        client_mid=outbound_client_mid,
        role="USER",
        author_kind="HUMAN",
        text=outbound_text,
        sent_at=outbound_sent_at,
        observed_at=outbound_sent_at,
        delivery_state="ACKNOWLEDGED",
        order_confidence="PLATFORM" if outbound_sent_at else "ACK",
        source=source,
        causal_after_message_id=inbound_message_id,
    )
    return bool(
        inbound["created"] or inbound["changed"] or outbound["created"] or outbound["changed"]
    )


async def record_action_ack(db, c, uid: int, job: dict, action: dict) -> dict | None:
    """Project one verified SEND_* receipt as AI-authored conversation history."""
    if (
        action.get("kind") not in {"SEND_TEXT", "SEND_GREETING"}
        or action.get("status") != "ACKNOWLEDGED"
        or not action.get("server_mid")
        or not all(
            job.get(name)
            for name in ("platform_account", "conversation_key", "boss_id", "encrypt_job_id")
        )
    ):
        return None
    occurred_at = None
    events = db.table("automation_action_event")
    event_rows = (
        (
            await c.execute(
                select(events.c.payload_json, events.c.created_at)
                .where(
                    events.c.user_id == uid,
                    events.c.action_id == action["id"],
                    events.c.kind == "RECEIPT",
                )
                .order_by(events.c.created_at, events.c.id)
            )
        )
        .mappings()
        .all()
    )
    for event in event_rows:
        payload = loads(event["payload_json"], {})
        if (
            payload.get("status") == "ACKNOWLEDGED"
            and payload.get("serverMid") == action["server_mid"]
        ):
            occurred_at = payload.get("occurredAt") or event["created_at"]
            break
    raw = loads(action["payload_json"], {})
    job_payload = loads(job.get("input_json"), {})
    job_input = job_payload.get("input") if isinstance(job_payload, dict) else None
    inbound_message_id = (
        job_input.get("inboundMessageId")
        if job.get("kind") == "REPLY" and isinstance(job_input, dict)
        else None
    )
    if not _positive_decimal(inbound_message_id):
        inbound_message_id = None
    return await upsert_message(
        db,
        c,
        uid,
        platform_account=job["platform_account"],
        conversation_key=job["conversation_key"],
        boss_id=job["boss_id"],
        encrypt_job_id=job["encrypt_job_id"],
        message_id=action["server_mid"],
        client_mid=action.get("client_mid"),
        role="USER",
        author_kind="AI",
        text=raw.get("text", ""),
        sent_at=None,
        observed_at=occurred_at or action.get("updated_at"),
        delivery_state="ACKNOWLEDGED",
        order_confidence="ACK",
        source="AUTOMATION_ACK:" + action["id"],
        causal_after_message_id=inbound_message_id,
    )


async def backfill_exact(db, c, uid: int) -> dict:
    """Idempotently reconstruct exact history from jobs/actions/observations."""
    stats = {"inserted": 0, "updated": 0, "skipped": 0, "conflicts": []}

    async def capture(awaitable, label: str):
        try:
            row = await awaitable
        except ApiError as exc:
            if exc.code == 422 and exc.message in {
                "EXACT_SERVER_MID_REQUIRED",
                "EXACT_CLIENT_MID_REQUIRED",
            }:
                stats["skipped"] += 1
                return
            if exc.code != 409:
                raise
            stats["conflicts"].append(label[:192])
            return
        if row is None:
            stats["skipped"] += 1
        elif row.get("created"):
            stats["inserted"] += 1
        elif row.get("changed"):
            stats["updated"] += 1
        else:
            stats["skipped"] += 1

    jobs = db.table("automation_job")
    job_rows = [
        dict(row)
        for row in (
            await c.execute(select(jobs).where(jobs.c.user_id == uid, jobs.c.kind == "REPLY"))
        ).mappings()
    ]
    jobs_by_id = {row["id"]: row for row in job_rows}
    for job in job_rows:
        raw = loads(job["input_json"], {})
        input_ = raw.get("input") or {}
        if not all(
            [
                job.get("platform_account"),
                job.get("conversation_key"),
                job.get("boss_id"),
                job.get("encrypt_job_id"),
                input_.get("inboundMessageId"),
            ]
        ):
            stats["skipped"] += 1
            continue
        sent_at = input_.get("inboundSentAt")
        await capture(
            upsert_message(
                db,
                c,
                uid,
                platform_account=job["platform_account"],
                conversation_key=job["conversation_key"],
                boss_id=job["boss_id"],
                encrypt_job_id=job["encrypt_job_id"],
                message_id=input_["inboundMessageId"],
                client_mid=None,
                role="HR",
                author_kind="HR",
                text=input_.get("question", ""),
                sent_at=sent_at,
                observed_at=sent_at or job["created_at"],
                delivery_state="OBSERVED",
                order_confidence="PLATFORM" if sent_at else "OBSERVED",
                source="MIGRATION_JOB:" + job["id"],
            ),
            "job:" + job["id"],
        )

    actions = db.table("automation_action")
    action_rows = [
        dict(row)
        for row in (
            await c.execute(
                select(actions).where(
                    actions.c.user_id == uid,
                    actions.c.kind.in_(["SEND_TEXT", "SEND_GREETING"]),
                    actions.c.status == "ACKNOWLEDGED",
                    actions.c.server_mid.is_not(None),
                )
            )
        ).mappings()
    ]
    if action_rows:
        missing = {row["job_id"] for row in action_rows} - set(jobs_by_id)
        if missing:
            for row in (
                await c.execute(select(jobs).where(jobs.c.user_id == uid, jobs.c.id.in_(missing)))
            ).mappings():
                jobs_by_id[row["id"]] = dict(row)
    for action in action_rows:
        job = jobs_by_id.get(action["job_id"])
        if not job:
            stats["skipped"] += 1
            continue
        await capture(record_action_ack(db, c, uid, job, action), "action:" + action["id"])

    observations = db.table("outcome_observation")
    for row in (
        await c.execute(select(observations).where(observations.c.user_id == uid))
    ).mappings():
        payload = loads(row["payload_json"], {})
        if not isinstance(payload, dict):
            stats["skipped"] += 1
            continue
        payload.setdefault("source", row["source"])
        payload.setdefault("observedAt", row["observed_at"])
        try:
            result = await project_observations(db, c, uid, [payload])
        except ApiError as exc:
            if exc.code != 409:
                raise
            stats["conflicts"].append("observation:" + row["id"])
            continue
        for key in ("inserted", "updated", "skipped"):
            stats[key] += result[key]
    stats["conflicts"] = stats["conflicts"][:100]
    return stats
