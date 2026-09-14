"""Monotonic execution authority; changing a setting back still invalidates old leases."""

from sqlalchemy import select

KEY = "automation:authority-epoch"
SESSION_KEY_PREFIX = "automation:session-authority-epoch:"


def session_authority_key(job_key: str) -> str:
    return SESSION_KEY_PREFIX + job_key


async def bump_authority(db, c, uid):
    users = db.table("user_info")
    await c.execute(select(users.c.id).where(users.c.id == uid).with_for_update())
    current = await db.control(uid, KEY, 0, c)
    next_value = (current if isinstance(current, int) else 0) + 1
    await db.set_control(c, uid, KEY, next_value)
    return next_value


async def bump_session_authority(db, c, uid, job_key: str):
    users = db.table("user_info")
    await c.execute(select(users.c.id).where(users.c.id == uid).with_for_update())
    key = session_authority_key(job_key)
    current = await db.control(uid, key, 0, c)
    next_value = (current if isinstance(current, int) and not isinstance(current, bool) else 0) + 1
    await db.set_control(c, uid, key, next_value)
    return next_value
