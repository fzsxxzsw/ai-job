import base64
import hashlib
import hmac
import json
import secrets
import time

from .errors import ApiError


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def issue_token(user_id: int, key: str, ttl: int = 43200, now: int | None = None) -> str:
    now = int(time.time()) if now is None else now
    body = _encode(
        json.dumps(
            {
                "sub": user_id,
                "iat": now,
                "exp": now + ttl,
                "iss": "job-helper-python",
                "jti": secrets.token_hex(16),
            },
            separators=(",", ":"),
        ).encode()
    )
    signed = "py1." + body
    return signed + "." + _encode(hmac.new(key.encode(), signed.encode(), hashlib.sha256).digest())


def verify_token(token: str, key: str, owner: int, now: int | None = None) -> int:
    try:
        if not isinstance(token, str) or len(token) > 2048:
            raise ValueError()
        prefix, body, signature = token.split(".")
        if prefix != "py1":
            raise ValueError()
        wanted = _encode(
            hmac.new(key.encode(), (prefix + "." + body).encode(), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(signature, wanted):
            raise ValueError()
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        now = int(time.time()) if now is None else now
        if not isinstance(claims, dict):
            raise ValueError()
        if claims.get("iss") != "job-helper-python" or type(claims.get("sub")) is not int:
            raise ValueError()
        if any(type(claims.get(field)) is not int for field in ("iat", "exp")):
            raise ValueError()
        if not 0 < claims["exp"] - claims["iat"] <= 604800:
            raise ValueError()
        if not isinstance(claims.get("jti"), str) or len(claims["jti"]) != 32:
            raise ValueError()
        if claims["sub"] != owner or not claims["iat"] - 30 <= now < claims["exp"]:
            raise ValueError()
        return claims["sub"]
    except (ValueError, KeyError, TypeError, UnicodeError):
        raise ApiError("登录已过期，请重新登录助手", 401) from None
