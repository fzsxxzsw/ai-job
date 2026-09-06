import hashlib
import hmac
import re
import time
from .contracts import MAX_ID, RejectionError


PREFIX = '/internal/rejections'


def canonical_assertion(method: str, path: str, uid: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    digest = hashlib.sha256(body).hexdigest()
    return '\n'.join(('jh-rejection-v1', method, path, uid, timestamp, nonce, digest)).encode('utf-8')


def sign(secret: str, method: str, path: str, uid: str, timestamp: str, nonce: str, body: bytes) -> str:
    return hmac.new(secret.encode('ascii'), canonical_assertion(method, path, uid, timestamp, nonce, body), hashlib.sha256).hexdigest()


def verify(secret: str, method: str, path: str, headers, body: bytes, now: int | None = None):
    # Identity never comes from JSON, query parameters, cookies or a browser header without this signature.
    uid = headers.get('x-jh-user', '')
    timestamp = headers.get('x-jh-timestamp', '')
    nonce = headers.get('x-jh-nonce', '')
    signature = headers.get('x-jh-signature', '')
    valid_shape = (re.fullmatch(r'[1-9][0-9]{0,15}', uid)
                   and re.fullmatch(r'[0-9]{10}', timestamp)
                   and re.fullmatch(r'[a-f0-9]{32}', nonce)
                   and re.fullmatch(r'[a-f0-9]{64}', signature))
    now = int(time.time()) if now is None else now
    if not valid_shape or int(uid) > MAX_ID or abs(now - int(timestamp)) > 30:
        raise RejectionError(401, '内部身份凭据无效或已过期')
    expected = sign(secret, method, path, uid, timestamp, nonce, body)
    if not hmac.compare_digest(signature, expected):
        raise RejectionError(401, '内部身份凭据校验失败')
    return int(uid), nonce, int(timestamp)
