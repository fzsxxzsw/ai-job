"""Monotonic execution authority; changing a setting back still invalidates old leases."""

from sqlalchemy import select

KEY = "automation:authority-epoch"


async def bump_authority(db, c, uid):
    users = db.table("user_info")
    await c.execute(select(users.c.id).where(users.c.id == uid).with_for_update())
    current = await db.control(uid, KEY, 0, c)
    next_value = (current if isinstance(current, int) else 0) + 1
    await db.set_control(c, uid, KEY, next_value)
    return next_value
