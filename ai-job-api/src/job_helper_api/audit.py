import hashlib

from sqlalchemy import select

from .database import now_ms
from .errors import ApiError
from .rejection_engine.service import save_snapshot as save_snapshot
from .rejection_engine.service import snapshot_view as snapshot_view


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


async def record_audit(db, uid, item):
    identity = (item.bossId, item.conversationKey, item.clientMid, item.serverMid)
    if item.status in ("acknowledged", "receipt") and (
        not all(identity) or item.clientMid == item.serverMid
    ):
        raise ApiError("送达凭据不完整，不能记录为已确认或已读", 422)
    t = db.table("delivery_audit")
    fields = {
        "delivery_key": item.deliveryKey,
        "kind": item.kind,
        "status": item.status,
        "job_title": item.jobTitle,
        "content_hash": item.contentHash,
        "content_length": item.contentLength,
        "attempts": item.attempts,
        "event_created_at": item.createdAt,
        "event_updated_at": item.updatedAt,
        "boss_id": item.bossId,
        "conversation_key": item.conversationKey,
        "client_mid": item.clientMid,
        "server_mid": item.serverMid,
        "last_observed_at": now_ms(),
    }
    where = (t.c.user_id == uid) & db.exact(t.c.audit_id, item.auditId)
    async with db.lock(uid, "audit:" + item.auditId):
        async with db.engine.begin() as c:
            row = await db.one(select(t).where(where).with_for_update(), c)
            if row:
                if (
                    row["content_hash"] != item.contentHash
                    or row["kind"] != item.kind
                    or row["delivery_key"] != item.deliveryKey
                ):
                    raise ApiError("审计记录身份或内容摘要冲突", 409)
                for column in ("boss_id", "conversation_key", "client_mid", "server_mid"):
                    if row[column] and fields[column] and row[column] != fields[column]:
                        raise ApiError("消息回执身份冲突", 409)
                    if not fields[column]:
                        fields[column] = row[column]
                stale = item.updatedAt < row["event_updated_at"]
                terminal = row["status"] == "receipt" or (
                    row["status"] == "acknowledged"
                    and item.status not in ("acknowledged", "receipt")
                )
                duplicate = (
                    item.status == row["status"] and item.updatedAt == row["event_updated_at"]
                )
                values = {
                    "observation_count": row["observation_count"] + 1,
                    "last_observed_at": now_ms(),
                    "duplicate_count": row["duplicate_count"] + int(duplicate),
                    "transition_count": row["transition_count"]
                    + int(not stale and not terminal and row["status"] != item.status),
                }
                if not stale and not terminal:
                    values.update(fields)
                await c.execute(t.update().where(t.c.id == row["id"]).values(**values))
                return {
                    "id": row["id"],
                    "status": row["status"] if stale or terminal else item.status,
                }
            result = await c.execute(
                t.insert().values(
                    **fields,
                    user_id=uid,
                    audit_id=item.auditId,
                    observation_count=1,
                    duplicate_count=0,
                    transition_count=0,
                )
            )
            return {"id": result.inserted_primary_key[0], "status": item.status}
