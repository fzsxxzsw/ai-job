"""Only the configured model provider is contacted. Never a browser or arbitrary URL proxy."""

import asyncio
import hashlib
import json
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

from .database import dumps
from .errors import ApiError

PROVIDERS = [
    {"code": 0, "desc": "自定义", "defaultBaseUrl": None, "custom": True},
    {
        "code": 1,
        "desc": "DeepSeek",
        "defaultBaseUrl": "https://api.deepseek.com/v1",
        "custom": False,
    },
    {
        "code": 2,
        "desc": "火山引擎",
        "defaultBaseUrl": "https://ark.cn-beijing.volces.com/api/v3",
        "custom": False,
    },
    {
        "code": 3,
        "desc": "硅基流动",
        "defaultBaseUrl": "https://api.siliconflow.cn/v1",
        "custom": False,
    },
    {
        "code": 4,
        "desc": "月之暗面",
        "defaultBaseUrl": "https://api.moonshot.cn/v1",
        "custom": False,
    },
    {
        "code": 5,
        "desc": "OpenRouter",
        "defaultBaseUrl": "https://openrouter.ai/api/v1",
        "custom": False,
    },
    {
        "code": 6,
        "desc": "阿里云百炼",
        "defaultBaseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "custom": False,
    },
]
MASKED_KEY = "********"


@dataclass(frozen=True)
class ModelConfig:
    base: str
    key: str = field(repr=False)
    name: str
    path: str = "/chat/completions"
    timeout: int = 15

    def fingerprint(self):
        return hashlib.sha256(
            dumps([self.base, self.key, self.name, self.path, self.timeout]).encode()
        ).hexdigest()


def effective_config(settings, row=None):
    if row and row.get("status") == 1:
        if row.get("test_passed") != 1:
            raise ApiError(
                "自定义模型尚未通过测试，请在 AI 配置中测试或停用后使用本地默认模型", 503
            )
        return row_config(row)
    return ModelConfig(
        settings.model_base,
        settings.model_key,
        settings.model_name,
        settings.completions_path,
        settings.model_timeout,
    )


def row_config(row):
    try:
        provider = int(row.get("provider") or 0)
        timeout = int(row.get("timeout") or 15)
        if not 0 <= provider < len(PROVIDERS) or not 1 <= timeout <= 120:
            raise ValueError()
    except (ValueError, TypeError):
        raise ApiError("模型配置中的供应商或超时设置无效，请重新保存配置", 400) from None
    base = row.get("base_url") or PROVIDERS[provider]["defaultBaseUrl"] or ""
    return ModelConfig(
        base,
        row.get("api_key") or "",
        row.get("model_name") or "",
        row.get("completions_path") or "/chat/completions",
        timeout,
    )


class ModelClient:
    def __init__(self, settings, transport=None):
        self.settings = settings
        self.http = httpx.AsyncClient(
            transport=transport,
            trust_env=False,
            follow_redirects=False,
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
        )
        self.slots = asyncio.Semaphore(2)

    def endpoint(self, config):
        try:
            u = urlsplit(config.base)
            port = u.port
        except ValueError:
            raise ApiError("模型地址格式无效", 400) from None
        allowed = {urlsplit(p["defaultBaseUrl"]).hostname for p in PROVIDERS if p["defaultBaseUrl"]}
        allowed.update(self.settings.allowed_model_hosts)
        allowed.add(urlsplit(self.settings.model_base).hostname)
        if (
            u.scheme != "https"
            or u.username
            or u.password
            or u.query
            or u.fragment
            or port not in (None, 443)
        ):
            raise ApiError("模型地址必须是 HTTPS 服务地址，不能包含账号、查询参数或非标准端口", 400)
        if not u.hostname or u.hostname not in allowed:
            raise ApiError("模型域名未在本机允许列表中，请配置 API_ALLOWED_MODEL_HOSTS", 400)
        if (
            not config.path.startswith("/")
            or config.path.startswith("//")
            or any(x in config.path for x in (":", "?", "#", "..", "\\"))
        ):
            raise ApiError("模型 completionsPath 必须为相对接口路径", 400)
        if not config.key or config.key == MASKED_KEY or not config.name:
            raise ApiError("未配置可用模型，请检查本机 AI_API_KEY、AI_MODEL 或 AI 配置", 503)
        return config.base.rstrip("/") + "/" + config.path.lstrip("/")

    async def complete(self, config, messages, max_tokens=1024):
        url = self.endpoint(config)
        body = {
            "model": config.name,
            "messages": messages,
            "stream": False,
            "max_tokens": max_tokens,
        }
        if urlsplit(config.base).hostname == "dashscope.aliyuncs.com":
            body.update(enable_thinking=True, thinking_budget=self.settings.thinking_budget)
        try:
            await asyncio.wait_for(self.slots.acquire(), timeout=3)
        except TimeoutError:
            raise ApiError("AI 正在处理其他请求，请稍后重试", 429) from None
        try:
            async with asyncio.timeout(config.timeout):
                async with self.http.stream(
                    "POST",
                    url,
                    headers={"Authorization": "Bearer " + config.key},
                    json=body,
                    timeout=httpx.Timeout(config.timeout, connect=5),
                ) as resp:
                    if resp.status_code in (401, 403):
                        raise ApiError("模型服务拒绝访问，请检查模型密钥及权限", 502)
                    if resp.status_code == 429:
                        raise ApiError("模型服务限流或额度不足，请稍后检查", 429)
                    if resp.status_code != 200:
                        raise ApiError("模型服务暂不可用", 502)
                    chunks, size = [], 0
                    async for part in resp.aiter_bytes():
                        size += len(part)
                        if size > 2_000_000:
                            raise ApiError("模型响应过大，已停止处理", 502)
                        chunks.append(part)
            data = json.loads(b"".join(chunks))
            result = data["choices"][0]["message"]["content"]
            if not isinstance(result, str) or not result.strip():
                raise ApiError("模型返回空内容，本次未执行任何动作", 502)
            return result.strip()
        except (TimeoutError, httpx.TimeoutException):
            raise ApiError("模型请求超时，本次未执行任何动作", 504) from None
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
            raise ApiError("模型响应无效，本次未执行任何动作", 502) from None
        finally:
            self.slots.release()


def structured_object(text):
    # Allow a single fenced JSON object; reject prose, arrays and multiple objects.
    try:
        value = text.strip()
        if value.startswith("```") and value.endswith("```"):
            language, separator, body = value.partition("\n")
            if not separator or language.lower() not in ("```", "```json"):
                raise ValueError()
            value = body[:-3].strip()
        result = json.loads(value)
        if not isinstance(result, dict):
            raise ValueError()
        return result
    except (ValueError, TypeError, AttributeError):
        raise ApiError("AI 未返回可验证的结构化结果，本次不做投递判断", 502) from None
