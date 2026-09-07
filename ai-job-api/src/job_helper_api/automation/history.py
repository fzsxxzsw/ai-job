"""Exact graph conversation history, with an explicit user-controlled round reset."""

import hashlib
from base64 import urlsafe_b64encode

from ..database import dumps


def history_key(raw):
    # Full SHA-256, encoded within the legacy MySQL session_key VARCHAR(64).
    value = hashlib.sha256(
        dumps([raw["platformAccount"], raw["conversationKey"]]).encode()
    ).digest()
    return "graph:" + urlsafe_b64encode(value).decode("ascii").rstrip("=")


async def current_rounds(db, uid, raw, c):
    key = history_key(raw)
    reset = await db.control(uid, "graph-round-reset:" + raw["input"]["jobKey"], 0, c)
    applied = await db.control(uid, "graph-round-applied:" + key, 0, c)
    rounds = await db.control(uid, "chat-rounds:" + key, 0, c)
    if applied != reset or not isinstance(rounds, int) or isinstance(rounds, bool) or rounds < 0:
        rounds = 0
    return rounds, reset
