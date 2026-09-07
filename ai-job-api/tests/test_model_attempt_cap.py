import json

import httpx
import pytest
from fastapi.testclient import TestClient
from test_model_routing import configure, login

from job_helper_api.errors import ApiError
from job_helper_api.main import create_app
from job_helper_api.model import effective_config
from job_helper_api.model_catalog import catalog


def test_per_request_cap_limits_real_mock_provider_attempts_without_changing_routing(world):
    names = [row["id"] for row in catalog() if "analysis" in row["supportedTasks"]][:5]
    assert len(names) == 5
    calls = []

    def provider(request):
        calls.append(json.loads(request.content)["model"])
        return httpx.Response(403, json={"error": {"code": "AllocationQuota.FreeTierOnly"}})

    with TestClient(create_app(world["settings"], httpx.MockTransport(provider))) as client:
        login(client)
        value = configure(client, names)
        value["config"]["maxAttempts"] = 5
        assert client.post("/api/user/ai/routing", json=value["config"]).status_code == 200

        async def request(cap):
            return await client.app.state.model.complete(
                effective_config(world["settings"], None),
                [{"role": "user", "content": "synthetic"}],
                task="analysis",
                max_attempts=cap,
            )

        with pytest.raises(ApiError):
            client.portal.call(request, 3)
        assert len(calls) == len(set(calls)) == 3
        assert client.get("/api/user/ai/routing").json()["data"]["config"]["maxAttempts"] == 5
        with pytest.raises(ApiError):
            client.portal.call(request, None)
        assert len(calls) == 5


@pytest.mark.parametrize("cap", [0, 4, True, "3", 1.5, -1])
def test_internal_attempt_cap_rejects_non_integer_or_out_of_range_before_network(world, cap):
    with TestClient(create_app(world["settings"], world["transport"])) as client:

        async def request():
            return await client.app.state.model.complete(
                effective_config(world["settings"], None), [], max_attempts=cap
            )

        with pytest.raises(ValueError):
            client.portal.call(request)
        assert world["fake"].calls == []
