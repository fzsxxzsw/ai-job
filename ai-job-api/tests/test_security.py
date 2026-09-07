import base64
import hashlib
import hmac
import json

import pytest

from job_helper_api.config import load_settings
from job_helper_api.errors import ApiError
from job_helper_api.security import verify_token


@pytest.mark.parametrize(
    "claims",
    [
        [],
        None,
        {"sub": 3},
        {"sub": 3, "iss": "job-helper-python", "iat": True, "exp": 200, "jti": "x" * 32},
        {"sub": 3, "iss": "job-helper-python", "iat": 100, "exp": "200", "jti": "x" * 32},
    ],
)
def test_even_signed_malformed_claims_return_authentication_error(claims):
    key = "test-secret-" * 4
    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    message = "py1." + body
    signature = (
        base64.urlsafe_b64encode(hmac.new(key.encode(), message.encode(), hashlib.sha256).digest())
        .decode()
        .rstrip("=")
    )
    with pytest.raises(ApiError) as caught:
        verify_token(message + "." + signature, key, 3, now=110)
    assert caught.value.http_status == 401


def test_generated_signing_key_is_persisted_across_settings_load(tmp_path, monkeypatch):
    secret_file = tmp_path / "data" / "session.key"
    monkeypatch.delenv("API_SESSION_SECRET", raising=False)
    monkeypatch.setenv("API_SECRET_FILE", str(secret_file))
    monkeypatch.setenv("MYSQL_PASSWORD", "fixture-only-password")
    monkeypatch.setenv("API_OWNER_USER_ID", "3")
    first = load_settings()
    second = load_settings()
    assert len(first.signing_key) >= 32 and first.signing_key == second.signing_key
    assert secret_file.read_text().strip() == first.signing_key
    assert "fixture-only-password" not in repr(first)
