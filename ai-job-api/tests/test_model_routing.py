import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from job_helper_api.database import Database
from job_helper_api.errors import ApiError
from job_helper_api.main import create_app
from job_helper_api.model import ModelClient, effective_config, parse_completion
from job_helper_api.model_catalog import SCREENSHOT_MODELS, model_info, thinking_options
from job_helper_api.model_routing import ModelRouter
from job_helper_api.routing_contracts import QuotaImport, RoutingInput


def snapshots(*names, remaining=100000):
    return {
        "snapshots": [
            {
                "id": name,
                "remainingTokens": remaining,
                "expiresOn": (datetime.now(UTC) + timedelta(days=20)).date().isoformat(),
                "observedAt": datetime.now(UTC).isoformat(),
                "freeOnlyConfirmed": True,
            }
            for name in names
        ]
    }


def configure(client, names=("qwen-turbo", "qwen-plus-2025-12-01"), **kwargs):
    response = client.post("/api/user/ai/routing/quotas", json=snapshots(*names, **kwargs))
    assert response.status_code == 200, response.text
    config = response.json()["data"]["config"]
    config["enabled"] = True
    response = client.post("/api/user/ai/routing", json=config)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def login(client):
    client.headers["Authorization"] = client.post(
        "/api/user/silently/login", params={"uniqueId": "boss-owner"}
    ).json()["data"]


def success(text="你好", tokens=30):
    return httpx.Response(
        200, json={"choices": [{"message": {"content": text}}], "usage": {"total_tokens": tokens}}
    )


def test_exact_free_quota_error_fails_over_and_persists_exhausted_model(world):
    calls = []

    def provider(request):
        body = json.loads(request.content)
        calls.append(body["model"])
        if body["model"] == "qwen-turbo":
            return httpx.Response(
                403,
                json={
                    "error": {
                        "code": "AllocationQuota.FreeTierOnly",
                        "message": "provider-secret-never-echo",
                    }
                },
            )
        return success()

    with TestClient(create_app(world["settings"], httpx.MockTransport(provider))) as client:
        login(client)
        configure(client)
        assert client.post("/api/job/ai/assistant/generate/greeting").status_code == 200
        view = client.get("/api/user/ai/routing").json()["data"]
        states = {row["id"]: row for row in view["models"]}
        assert states["qwen-turbo"]["status"] == "free_quota_exhausted"
        assert states["qwen-turbo"]["remainingTokensEstimate"] == 0
        assert states["qwen-turbo"]["reportedTokens"] == 0
        assert states["qwen-plus-2025-12-01"]["remainingTokensEstimate"] == 99970
        assert calls == ["qwen-turbo", "qwen-plus-2025-12-01"]
        assert "provider-secret-never-echo" not in json.dumps(view)
        assert "测试候选人" not in json.dumps(view, ensure_ascii=False)
    with TestClient(create_app(world["settings"], httpx.MockTransport(provider))) as client:
        login(client)
        assert client.post("/api/job/ai/assistant/generate/greeting").status_code == 200
        assert calls[-1] == "qwen-plus-2025-12-01" and len(calls) == 3


@pytest.mark.parametrize("status,code", [(401, "InvalidApiKey"), (403, "AccessDenied"), (403, "")])
def test_authentication_and_permission_errors_never_rotate_credentials_or_models(
    world, status, code
):
    calls = []

    def provider(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"code": code}})

    with TestClient(create_app(world["settings"], httpx.MockTransport(provider))) as client:
        login(client)
        configure(client)
        assert client.post("/api/job/ai/assistant/generate/greeting").status_code == 502
        assert len(calls) == 1
        assert all(
            m["status"] != "free_quota_exhausted"
            for m in client.get("/api/user/ai/routing").json()["data"]["models"]
        )


def test_rate_limit_cools_model_and_switches_without_claiming_quota_exhaustion(world):
    calls = []

    def provider(request):
        name = json.loads(request.content)["model"]
        calls.append(name)
        return (
            httpx.Response(429, json={"error": {"code": "Throttling"}})
            if name == "qwen-turbo"
            else success()
        )

    with TestClient(create_app(world["settings"], httpx.MockTransport(provider))) as client:
        login(client)
        configure(client)
        assert client.post("/api/job/ai/assistant/generate/greeting").status_code == 200
        first = client.get("/api/user/ai/routing").json()["data"]["models"][0]
        assert first["status"] == "cooldown"
        assert first["remainingTokensEstimate"] == 100000
        assert len(calls) == 2


def test_snapshot_reimport_is_idempotent_and_config_conflicts_are_rejected(client, world):
    snapshot = snapshots("qwen-turbo")
    config = client.post("/api/user/ai/routing/quotas", json=snapshot).json()["data"]["config"]
    config["enabled"] = True
    assert client.post("/api/user/ai/routing", json=config).status_code == 200
    assert client.post("/api/user/ai/routing", json=config).status_code == 409
    assert client.post("/api/job/ai/assistant/generate/greeting").status_code == 200
    remaining = client.get("/api/user/ai/routing").json()["data"]["models"][0][
        "remainingTokensEstimate"
    ]
    assert 0 < remaining < 100000  # Missing usage retains the conservative reservation.
    after = client.post("/api/user/ai/routing/quotas", json=snapshot).json()["data"]
    assert after["models"][0]["remainingTokensEstimate"] == remaining


def test_unknown_expired_and_specialized_models_cannot_be_enabled(client, world):
    value = snapshots("qwen-turbo", "qwen3-omni-flash-realtime")
    value["snapshots"][0]["expiresOn"] = "2020-01-01"
    response = client.post("/api/user/ai/routing/quotas", json=value)
    data = response.json()["data"]
    assert data["models"][0]["status"] == "expired"
    assert data["models"][1]["status"] == "unsupported"
    config = data["config"]
    config["enabled"] = True
    assert client.post("/api/user/ai/routing", json=config).status_code == 422
    assert world["fake"].calls == []


def test_enabled_pool_never_falls_back_to_untracked_default_model(client, world):
    data = configure(client, names=("qwen3-coder-plus",))
    assert data["config"]["models"][0]["tasks"] == ["analysis"]
    response = client.post("/api/job/ai/assistant/generate/greeting")
    assert response.status_code == 503
    assert world["fake"].calls == []


def test_routes_require_login_and_writable_mode(world):
    with TestClient(create_app(world["settings"], world["transport"])) as client:
        assert client.get("/api/user/ai/routing").status_code == 401
        assert (
            client.post("/api/user/ai/routing/quotas", json=snapshots("qwen-turbo")).status_code
            == 401
        )
    with TestClient(
        create_app(replace(world["settings"], read_only=True), world["transport"])
    ) as client:
        login(client)
        assert (
            client.post("/api/user/ai/routing/quotas", json=snapshots("qwen-turbo")).status_code
            == 503
        )


def test_concurrent_calls_cannot_spend_same_remaining_quota_twice(world):
    calls = []

    async def provider(request):
        calls.append(request)
        await asyncio.sleep(0.05)
        return success(tokens=10)

    async def run():
        db = Database(world["settings"].database_url)
        await db.health()
        router = ModelRouter(world["settings"], db, httpx.MockTransport(provider))
        config = effective_config(world["settings"])
        try:
            view = await router.import_quota(
                config, QuotaImport.model_validate(snapshots("qwen-turbo", remaining=1800))
            )
            view["config"]["enabled"] = True
            await router.save(config, RoutingInput.model_validate(view["config"]))
            results = await asyncio.gather(
                *[
                    router.complete(config, [{"role": "user", "content": "ok"}], task="greeting")
                    for _ in range(2)
                ],
                return_exceptions=True,
            )
            assert sum(isinstance(result, ApiError) for result in results) == 1
            assert len(calls) == 1
            assert (await router.view(config))["models"][0]["remainingTokensEstimate"] == 1790
        finally:
            await router.http.aclose()
            await db.close()

    asyncio.run(run())


def test_key_change_does_not_reuse_another_credentials_quota(world):
    async def run():
        db = Database(world["settings"].database_url)
        await db.health()
        router = ModelRouter(world["settings"], db, world["transport"])
        try:
            config = effective_config(world["settings"])
            await router.import_quota(config, QuotaImport.model_validate(snapshots("qwen-turbo")))
            assert (await router.view(replace(config, key="other-secret")))["models"] == []
        finally:
            await router.http.aclose()
            await db.close()

    asyncio.run(run())


def test_streamed_text_and_usage_are_collected_but_reasoning_is_not_returned():
    raw = b'data: {"choices":[{"delta":{"reasoning_content":"private chain"}}]}\n\ndata: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"total_tokens":42}}\n\ndata: [DONE]\n\n'
    data = parse_completion(raw)
    assert data["choices"][0]["message"]["content"] == "OK"
    assert data["usage"]["total_tokens"] == 42
    assert "private chain" not in json.dumps(data)
    with pytest.raises(ApiError):
        parse_completion(b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')


def test_catalog_and_provider_options_do_not_force_qwen_thinking_on_every_model():
    assert len(SCREENSHOT_MODELS) == len(set(SCREENSHOT_MODELS))
    assert len(SCREENSHOT_MODELS) >= 60
    assert model_info("qwen3-omni-flash")["protocol"] == "chat-stream"
    assert model_info("qwen3-omni-flash-realtime")["supportedTasks"] == []
    assert thinking_options("glm-5", "auto", 256) == {}
    assert thinking_options("qwen-turbo", "auto", 256) == {}
    assert thinking_options("qwen3.5-27b", "auto", 256) == {"enable_thinking": False}


def test_catalog_endpoint_is_honest_about_absent_provider_models_api(client, world):
    response = client.post("/api/user/ai/routing/discover")
    assert response.status_code == 200
    assert response.json()["data"]["source"] == "bundled_catalog"
    assert response.json()["data"]["quotaIncluded"] is False
    assert world["fake"].calls == []


def test_omni_uses_text_stream_protocol(world):
    bodies = []

    def provider(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            content=b'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}],"usage":{"total_tokens":12}}\n\ndata: [DONE]\n\n',
        )

    async def run():
        client = ModelClient(world["settings"], httpx.MockTransport(provider))
        try:
            result = await client.complete(
                replace(effective_config(world["settings"]), name="qwen3-omni-flash"),
                [{"role": "user", "content": "ok"}],
            )
            assert result == "OK" and result.total_tokens == 12
            assert bodies[0]["stream"] is True and bodies[0]["modalities"] == ["text"]
        finally:
            await client.http.aclose()

    asyncio.run(run())


def test_attempt_limit_retains_uncertain_usage_and_never_tries_same_model_twice(world):
    calls = []

    def provider(request):
        calls.append(json.loads(request.content)["model"])
        return httpx.Response(500, json={"error": {"code": "InternalError"}})

    with TestClient(create_app(world["settings"], httpx.MockTransport(provider))) as client:
        login(client)
        data = configure(client, names=("qwen-turbo", "qwen-max", "glm-5"))
        config = data["config"]
        config["maxAttempts"] = 2
        assert client.post("/api/user/ai/routing", json=config).status_code == 200
        assert client.post("/api/job/ai/assistant/generate/greeting").status_code == 503
        assert len(calls) == len(set(calls)) == 2
        view = client.get("/api/user/ai/routing").json()["data"]
        assert sum(m["estimatedTokens"] for m in view["models"]) > 0
        assert sum(m["reportedTokens"] for m in view["models"]) == 0


def test_disabling_pool_during_failure_prevents_next_attempt(world):
    calls = []

    async def run():
        db = Database(world["settings"].database_url)
        await db.health()
        config = effective_config(world["settings"])

        async def provider(request):
            calls.append(request)
            value = (await router.view(config))["config"]
            value["enabled"] = False
            await router.save(config, RoutingInput.model_validate(value))
            return httpx.Response(429, json={"error": {"code": "Throttling"}})

        router = ModelRouter(world["settings"], db, httpx.MockTransport(provider))
        try:
            view = await router.import_quota(
                config, QuotaImport.model_validate(snapshots("qwen-turbo", "qwen-max"))
            )
            view["config"]["enabled"] = True
            await router.save(config, RoutingInput.model_validate(view["config"]))
            with pytest.raises(ApiError):
                await router.complete(config, [{"role": "user", "content": "ok"}], task="greeting")
            assert len(calls) == 1
        finally:
            await router.http.aclose()
            await db.close()

    asyncio.run(run())


def test_free_stop_confirmation_is_required_before_enabling(client, world):
    data = configure(client)
    config = data["config"]
    config["models"][0]["freeOnlyConfirmed"] = False
    assert client.post("/api/user/ai/routing", json=config).status_code == 422
    assert world["fake"].calls == []
