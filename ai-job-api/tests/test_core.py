import sqlite3
from dataclasses import replace

import httpx
import pytest
from fastapi.testclient import TestClient

from job_helper_api.errors import ApiError
from job_helper_api.main import create_app
from job_helper_api.security import issue_token, verify_token

FILTER = {
    "prompt": "杭州，双休",
    "jobBaseInfo": '{"city":"杭州"}',
    "jobExtInfo": '{"schedule":"双休"}',
}


def test_signed_token_expiry_identity_and_tampering():
    key = "test-key-" * 8
    token = issue_token(3, key, ttl=60, now=100)
    assert verify_token(token, key, 3, now=110) == 3
    for bad, now, owner in [
        (token, 161, 3),
        (token, 110, 9),
        (token + "x", 110, 3),
        ("base64-java-session", 110, 3),
    ]:
        with pytest.raises(ApiError):
            verify_token(bad, key, owner, now=now)


def test_health_and_python_build_are_real_and_model_free(client, world):
    result = client.get("/actuator/health")
    assert result.json()["implementation"] == "python"
    assert result.json()["status"] == "UP"
    assert result.headers["x-job-helper-backend"] == "python"
    assert world["fake"].calls == []


def test_owner_only_login_and_authentication(client):
    assert (
        client.post("/api/user/silently/login", params={"uniqueId": "other-account"}).status_code
        == 401
    )
    assert (
        client.post("/api/user/userinfo", headers={"Authorization": "old-java-token"}).status_code
        == 401
    )
    assert client.post("/api/user/save/preference", json={"userId": 9}).status_code == 422
    assert client.get("/api/deployment/mode").json()["data"]["salesEnabled"] is False


def test_hostile_origin_rejected_before_login(client):
    r = client.post(
        "/api/user/silently/login",
        params={"uniqueId": "boss-owner"},
        headers={"Origin": "https://evil.example"},
    )
    assert r.status_code == 403
    r = client.options(
        "/api/user/userinfo",
        headers={
            "Origin": "https://www.zhipin.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization",
        },
    )
    assert r.status_code == 200


def test_partial_preference_update_keeps_seat_state_and_other_user(client, world):
    r = client.post("/api/user/save/preference", json={"email": "owner@example.test"})
    assert r.json()["code"] == 200
    info = client.post("/api/user/userinfo").json()["data"]
    assert info["aiSeatStatus"] is True and info["preference"] == {"pi": 15}
    assert info["resumeId"] == "resume-old"
    with sqlite3.connect(world["path"]) as db:
        assert db.execute("SELECT phone FROM user_info WHERE id=9").fetchone()[0] == "private"


def test_tokens_and_preferences_survive_process_restart(client, world):
    client.post("/api/user/save/preference", json={"aiSeatStatus": False})
    token = client.headers["Authorization"]
    with TestClient(create_app(world["settings"], world["transport"])) as restarted:
        r = restarted.post("/api/user/userinfo", headers={"Authorization": token})
        assert r.status_code == 200 and r.json()["data"]["aiSeatStatus"] is False


def test_filter_compatible_response(client, world):
    r = client.post("/api/job/filter/one", json=FILTER)
    assert r.status_code == 200 and r.json()["data"] == {"filter": False, "reason": "岗位符合要求"}
    assert set(r.json()) == {"data", "code", "message", "extend", "requestId"}
    assert FILTER["prompt"] in world["fake"].calls[-1]["messages"][-1]["content"]


@pytest.mark.parametrize(
    "bad", ["", "not JSON", '{"filter":"false","reason":"bad"}', '{"filter":false}', "{}{}"]
)
def test_bad_model_output_never_means_match(client, world, bad):
    world["fake"].output = bad
    r = client.post("/api/job/filter/one", json=FILTER)
    assert r.status_code == 502 and r.json()["data"] is None


@pytest.mark.parametrize("status,expected", [(401, 502), (403, 502), (429, 429), (500, 502)])
def test_provider_failures_are_explicit_and_sanitized(client, world, status, expected):
    world["fake"].status = status
    r = client.post("/api/job/filter/one", json=FILTER)
    assert r.status_code == expected
    assert "provider-secret" not in r.text


def test_timeout_is_not_a_success(client, world):
    world["fake"].exception = httpx.ReadTimeout("private credential in upstream error")
    r = client.post("/api/job/filter/one", json=FILTER)
    assert r.status_code == 504 and "private credential" not in r.text


def test_readonly_canary_cannot_write(world):
    with TestClient(
        create_app(replace(world["settings"], read_only=True), world["transport"])
    ) as c:
        c.headers["Authorization"] = c.post(
            "/api/user/silently/login", params={"uniqueId": "boss-owner"}
        ).json()["data"]
        assert c.post("/api/user/userinfo").status_code == 200
        assert c.post("/api/user/save/preference", json={"aiSeatStatus": False}).status_code == 503
        assert (
            c.post(
                "/api/job/seeker/cloned/ask", json={"jobKey": "job:peer", "question": "你好"}
            ).status_code
            == 503
        )


@pytest.mark.parametrize(
    "url",
    [
        "/api/pay/getQr",
        "/api/pay/generate/order/group",
        "/api/user/invites/exchange/products",
        "/api/sse/connect",
    ],
)
def test_sales_are_gone(client, url):
    assert client.get(url).status_code == 410


def test_admin_route_is_not_unlocked_by_personal_mode(client):
    r = client.post(
        "/api/job/seeker/cloned/change/session/admin/status",
        params={"jobKey": "globalJobKey", "stop": True},
    )
    assert r.status_code == 403


def test_missing_database_tables_fails_readiness(world, tmp_path):
    with TestClient(
        create_app(
            replace(
                world["settings"],
                database_url="sqlite+aiosqlite:///" + (tmp_path / "empty.db").as_posix(),
            ),
            world["transport"],
        )
    ) as c:
        assert c.get("/health/live").status_code == 200
        assert c.get("/health/ready").status_code == 503


def test_authenticated_routes_reject_disabled_owner_immediately(client, world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE user_info SET is_active=0 WHERE id=3")
    assert client.post("/api/user/userinfo").status_code == 401
    assert client.post("/api/job/filter/one", json=FILTER).status_code == 401
    assert world["fake"].calls == []


def test_preferences_allow_clearing_contacts_but_enforce_legacy_column_limits(client):
    assert (
        client.post(
            "/api/user/save/preference",
            json={"email": "owner@example.test", "phone": "13800138000"},
        ).status_code
        == 200
    )
    assert (
        client.post("/api/user/save/preference", json={"email": "", "phone": ""}).status_code == 200
    )
    info = client.post("/api/user/userinfo").json()["data"]
    assert info["email"] == "" and info["phone"] == ""
    for payload in (
        {"email": "bad\nBcc: other@example.test"},
        {"email": "x" * 50 + "@example.test"},
        {"phone": "1" * 12},
    ):
        assert client.post("/api/user/save/preference", json=payload).status_code == 422


def test_json_body_limit_checks_actual_bytes_not_only_header(client):
    response = client.post(
        "/api/user/save/preference",
        content=b"x" * 512_001,
        headers={"Content-Type": "application/json", "Content-Length": "1"},
    )
    assert response.status_code == 413


def test_rejection_read_routes_and_status_require_authentication(client):
    for path in (
        "/api/job/ai/rejections/history",
        "/api/job/ai/rejections/status",
        "/api/job/ai/rejections/1",
    ):
        assert client.get(path, headers={"Authorization": ""}).status_code == 401
    result = client.get("/api/job/ai/rejections/status").json()["data"]
    assert result["implementation"] == "python" and result["automaticTrigger"] is False


def test_health_reports_custom_model_configuration_without_calling_provider(client, world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "INSERT INTO user_ai_config(user_id,provider,model_name,api_key,status,test_passed,is_active) VALUES (3,0,'custom','secret',1,0,1)"
        )
    response = client.get("/health/ready")
    assert response.json()["version"] == "0.0.65"
    assert response.json()["checks"]["model"] == "custom_not_verified"
    assert world["fake"].calls == []
