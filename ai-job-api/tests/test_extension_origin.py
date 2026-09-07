import sqlite3

import pytest

EXTENSION_ORIGIN = "chrome-extension://dkogipipnemadnlpchlgpphagpboekmm"
AUDIT_URL = "/api/job/delivery/audit"
AUDIT = {
    "auditId": "greeting:extension-origin",
    "deliveryKey": "extension-origin",
    "kind": "greeting",
    "status": "sending",
    "jobTitle": "fixture",
    "contentHash": "5:abc",
    "contentLength": 5,
    "attempts": 1,
    "createdAt": 1700000000000,
    "updatedAt": 1700000000010,
}


@pytest.mark.parametrize(
    "origin",
    [
        EXTENSION_ORIGIN,
        "https://www.zhipin.com",
        "https://zhipin.com",
        "http://127.0.0.1:5173",
    ],
)
def test_trusted_origin_preflight_and_authenticated_audit(client, world, origin):
    preflight = client.options(
        AUDIT_URL,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin
    assert preflight.headers["access-control-allow-credentials"] == "true"
    allowed_headers = preflight.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers and "content-type" in allowed_headers

    response = client.post(AUDIT_URL, headers={"Origin": origin}, json=AUDIT)
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "sending"
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"
    with sqlite3.connect(world["path"]) as db:
        assert db.execute("SELECT user_id,audit_id FROM delivery_audit").fetchall() == [
            (3, AUDIT["auditId"])
        ]


def test_installed_extension_origin_still_requires_token(client, world):
    del client.headers["Authorization"]
    response = client.post(AUDIT_URL, headers={"Origin": EXTENSION_ORIGIN}, json=AUDIT)
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == EXTENSION_ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"
    with sqlite3.connect(world["path"]) as db:
        assert db.execute("SELECT COUNT(*) FROM delivery_audit").fetchone() == (0,)


@pytest.mark.parametrize(
    "origin",
    [
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        EXTENSION_ORIGIN + ".evil.example",
        "https://evil.example",
        "https://www.zhipin.com.evil.example",
    ],
)
def test_untrusted_origin_cannot_preflight_or_write_with_valid_token(client, world, origin):
    preflight = client.options(
        AUDIT_URL,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    response = client.post(AUDIT_URL, headers={"Origin": origin}, json=AUDIT)
    for result in (preflight, response):
        assert result.status_code == 403
        assert "access-control-allow-origin" not in result.headers
        assert "access-control-allow-credentials" not in result.headers
    with sqlite3.connect(world["path"]) as db:
        assert db.execute("SELECT COUNT(*) FROM delivery_audit").fetchone() == (0,)
