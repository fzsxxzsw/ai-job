import asyncio

import pytest

from job_helper_api.errors import ApiError
from job_helper_api.model import ModelClient, ModelConfig, row_config, structured_object


@pytest.mark.parametrize(
    "row",
    [
        {"provider": -1},
        {"provider": 99},
        {"provider": "broken"},
        {"timeout": "broken"},
        {"timeout": 999},
    ],
)
def test_damaged_legacy_configuration_returns_controlled_error(row):
    with pytest.raises(ApiError) as error:
        row_config(row)
    assert error.value.code == 400


@pytest.mark.parametrize(
    "base",
    [
        "https://dashscope.aliyuncs.com:invalid",
        "https://[broken",
        "https://user:secret@dashscope.aliyuncs.com/v1",
    ],
)
def test_invalid_model_address_is_rejected_without_network_or_secret_echo(world, base):
    async def run():
        client = ModelClient(world["settings"], world["transport"])
        try:
            with pytest.raises(ApiError) as error:
                client.endpoint(ModelConfig(base, "private-key", "fixture"))
            assert error.value.code == 400 and "private-key" not in error.value.message
            assert world["fake"].calls == []
        finally:
            await client.http.aclose()

    asyncio.run(run())


@pytest.mark.parametrize(
    "value", ["```", "```json```", "```text\n{}\n```", "[]", "{}{}", "before {}", None]
)
def test_invalid_json_wrappers_return_api_error(value):
    with pytest.raises(ApiError):
        structured_object(value)


def test_single_json_object_with_optional_json_fence_is_supported():
    assert structured_object('```json\n{"filter":false}\n```') == {"filter": False}
    assert structured_object('{"filter":false}') == {"filter": False}
