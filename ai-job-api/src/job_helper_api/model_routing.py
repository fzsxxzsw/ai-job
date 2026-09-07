"""Free-quota-aware routing. Provider stop-at-free-tier remains the billing authority.

Balances are imported snapshots minus observed local usage, not a billing API.
Reservations survive crashes as conservative estimates. No prompts or keys are stored.
"""

import asyncio
import hashlib
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from uuid import uuid4

from .database import dumps, now_ms
from .errors import ApiError
from .model import ModelClient, ProviderError
from .model_catalog import TASKS, catalog, model_info
from .routing_contracts import RouteModel, RoutingInput

CHINA = timezone(timedelta(hours=8))


def quota_scope(config):
    return (
        "model-routing:"
        + hashlib.sha256(
            dumps([config.base.rstrip("/"), config.key, config.path]).encode()
        ).hexdigest()
    )


def empty_document():
    return {"config": RoutingInput().model_dump(), "stats": {}, "events": []}


def empty_stats():
    return {
        "charged": 0,
        "reportedTokens": 0,
        "estimatedTokens": 0,
        "requests": 0,
        "failures": 0,
        "pending": {},
        "blocked": "",
        "cooldownUntil": 0,
        "lastUsed": 0,
        "lastTest": None,
    }


def expire_pending(state):
    # An interrupted request may have been billed. Keep its reservation charged.
    state["pending"] = {
        key: value for key, value in state["pending"].items() if value["at"] > now_ms() - 180_000
    }


def estimated_remaining(state):
    if state.get("blocked") == "free_quota_exhausted":
        return 0
    snapshot = state.get("snapshot")
    if not snapshot:
        return None
    return max(
        0, snapshot["remainingTokens"] - max(0, state["charged"] - snapshot["chargeAtSnapshot"])
    )


def eligibility(row, state, required=0):
    if not model_info(row["id"])["supportedTasks"]:
        return "unsupported"
    if not row["enabled"]:
        return "disabled"
    if not row["freeOnlyConfirmed"]:
        return "free_stop_unconfirmed"
    if not state.get("snapshot"):
        return "quota_unknown"
    if state["snapshot"]["expiresOn"] <= datetime.now(CHINA).date().isoformat():
        return "expired"
    if state["blocked"]:
        return state["blocked"]
    if state["cooldownUntil"] > now_ms():
        return "cooldown"
    if estimated_remaining(state) <= required:
        return "insufficient_quota"
    return "ready"


def request_reservation(messages, max_tokens):
    # Deliberately conservative UTF-8 estimate. Actual provider usage replaces it.
    return len(dumps(messages).encode("utf-8")) + max_tokens + 512


def routing_rank(row, state, task, strategy):
    name = row["id"].lower()
    suitability = 0
    if task in {"filter", "greeting"}:
        suitability = 2 if any(x in name for x in ("flash", "turbo", "-8b", "-14b")) else 1
    elif task == "analysis":
        suitability = (
            2 if any(x in name for x in ("max", "thinking", "deepseek", "glm-5", "minimax")) else 1
        )
    else:
        suitability = 2 if any(x in name for x in ("plus", "27b", "32b", "35b", "glm-4.5")) else 1
    expiry = state["snapshot"]["expiresOn"]
    quality = (-row["priority"], -suitability)
    return ((expiry, *quality) if strategy == "expiry_first" else (*quality, expiry)) + (
        state["lastUsed"],
        name,
    )


class ModelRouter(ModelClient):
    def __init__(self, settings, db, transport=None):
        super().__init__(settings, transport)
        self.db = db
        self.uid = settings.owner_user_id

    def validate_provider(self, config):
        self.endpoint(config)
        if (
            config.base.rstrip("/") != "https://dashscope.aliyuncs.com/compatible-mode/v1"
            or config.path != "/chat/completions"
        ):
            raise ApiError("免费额度模型池目前支持百炼北京地域的标准 Chat 接口", 422)

    async def document(self, config, connection=None):
        return await self.db.control(self.uid, quota_scope(config), empty_document(), connection)

    async def view(self, config):
        doc = await self.document(config)
        models = []
        for row in doc["config"]["models"]:
            state = doc["stats"].get(row["id"], empty_stats())
            expire_pending(state)
            models.append(
                {
                    **row,
                    **model_info(row["id"]),
                    "status": eligibility(row, state),
                    "remainingTokensEstimate": estimated_remaining(state),
                    "snapshot": state.get("snapshot"),
                    "reportedTokens": state["reportedTokens"],
                    "estimatedTokens": state["estimatedTokens"],
                    "requests": state["requests"],
                    "failures": state["failures"],
                    "lastTest": state["lastTest"],
                    "cooldownUntil": state["cooldownUntil"],
                }
            )
        return {
            "config": doc["config"],
            "models": models,
            "events": doc["events"],
            "catalog": catalog(),
            "tasks": TASKS,
            "provider": urlsplit(config.base).hostname,
            "configuredModel": config.name,
            "balanceSource": "imported_snapshot_minus_local_usage",
            "balanceNote": "剩余量为导入的控制台快照减去本地用量估算，不含其他应用或 Key 的消耗。实际免费额度以百炼为准。",
            "providerSupported": config.base.rstrip("/")
            == "https://dashscope.aliyuncs.com/compatible-mode/v1",
        }

    async def save(self, config, payload):
        self.validate_provider(config)
        for row in payload.models:
            supported = model_info(row.id)["supportedTasks"]
            if row.enabled and (not row.tasks or not set(row.tasks) <= set(supported)):
                raise ApiError("启用的模型必须选择受支持的任务类型", 422)
            if row.enabled and not row.freeOnlyConfirmed:
                raise ApiError("请先确认该模型在百炼开启免费额度用完即停", 422)
        async with self.db.lock(self.uid, quota_scope(config)):
            async with self.db.engine.begin() as c:
                doc = await self.document(config, c)
                if payload.revision != doc["config"]["revision"]:
                    raise ApiError("模型配置已变化，请重新加载后保存", 409)
                if payload.enabled and not any(
                    eligibility(row.model_dump(), doc["stats"].get(row.id, empty_stats()))
                    == "ready"
                    for row in payload.models
                ):
                    raise ApiError("没有可用的免费模型，请先导入额度并检查状态", 422)
                doc["config"] = payload.model_dump()
                doc["config"]["revision"] += 1
                await self.db.set_control(c, self.uid, quota_scope(config), doc)
        return await self.view(config)

    async def import_quota(self, config, payload):
        self.validate_provider(config)
        async with self.db.lock(self.uid, quota_scope(config)):
            async with self.db.engine.begin() as c:
                doc = await self.document(config, c)
                rows = {row["id"]: row for row in doc["config"]["models"]}
                for snapshot in payload.snapshots:
                    state = doc["stats"].setdefault(snapshot.id, empty_stats())
                    expire_pending(state)
                    if state["pending"]:
                        raise ApiError("模型仍有进行中的请求，请完成后再校准额度", 409)
                    observed = snapshot.observedAt.timestamp() * 1000
                    if observed > now_ms() + 60_000:
                        raise ApiError("额度快照时间不能在未来", 422)
                    old = state.get("snapshot")
                    if old and observed <= old["observedAtMs"]:
                        continue  # Idempotent imports cannot replenish consumed quota.
                    if old and observed < state["lastUsed"]:
                        raise ApiError("新额度快照早于最近调用，请使用更新的控制台余额", 422)
                    # First import after local requests is also conservative.
                    baseline = state["charged"] if observed >= state["lastUsed"] else 0
                    state["snapshot"] = {
                        **snapshot.model_dump(mode="json"),
                        "observedAtMs": observed,
                        "chargeAtSnapshot": baseline,
                    }
                    if state["blocked"] == "free_quota_exhausted" and snapshot.remainingTokens > 0:
                        state["blocked"] = ""
                    info = model_info(snapshot.id)
                    if snapshot.id not in rows:
                        rows[snapshot.id] = RouteModel(
                            id=snapshot.id,
                            tasks=info["supportedTasks"],
                            enabled=bool(info["supportedTasks"]) and snapshot.freeOnlyConfirmed,
                            freeOnlyConfirmed=snapshot.freeOnlyConfirmed,
                        ).model_dump()
                    else:
                        rows[snapshot.id]["freeOnlyConfirmed"] = snapshot.freeOnlyConfirmed
                doc["config"]["models"] = list(rows.values())
                doc["config"]["revision"] += 1
                await self.db.set_control(c, self.uid, quota_scope(config), doc)
        return await self.view(config)

    async def discover(self, config):
        self.validate_provider(config)
        # Model Studio does not provide an OpenAI GET /models endpoint. Never
        # pretend a public catalogue is this key's permission/quota inventory.
        return {
            "models": catalog(),
            "source": "bundled_catalog",
            "quotaIncluded": False,
            "note": "百炼兼容接口不提供 GET /models；此目录不代表实时授权或额度。",
        }

    async def reserve(self, config, task, amount, excluded, specific=None):
        async with self.db.lock(self.uid, quota_scope(config)):
            async with self.db.engine.begin() as c:
                doc = await self.document(config, c)
                if not specific and not doc["config"]["enabled"]:
                    return None
                candidates = []
                for row in doc["config"]["models"]:
                    state = doc["stats"].setdefault(row["id"], empty_stats())
                    expire_pending(state)
                    if row["id"] in excluded or (specific and row["id"] != specific):
                        continue
                    if not specific and task not in row["tasks"]:
                        continue
                    status = eligibility(row, state, amount)
                    # Manual tests may recheck a cooled/incompatible endpoint, but never a depleted quota.
                    if specific and status in {"cooldown", "model_unavailable", "invalid_request"}:
                        state = {**state, "blocked": "", "cooldownUntil": 0}
                        status = eligibility(row, state, amount)
                    if status == "ready":
                        candidates.append((row, state))
                if not candidates:
                    return None
                row, _ = min(
                    candidates, key=lambda x: routing_rank(*x, task, doc["config"]["strategy"])
                )
                state = doc["stats"][row["id"]]
                ticket = uuid4().hex
                state["pending"][ticket] = {"at": now_ms(), "tokens": amount}
                state["charged"] += amount
                state["estimatedTokens"] += amount
                state["lastUsed"] = now_ms()
                await self.db.set_control(c, self.uid, quota_scope(config), doc)
                return row, ticket

    async def settle(self, config, row, ticket, task, started, result=None, error=None):
        async with self.db.lock(self.uid, quota_scope(config)):
            async with self.db.engine.begin() as c:
                doc = await self.document(config, c)
                state = doc["stats"][row["id"]]
                reservation = state["pending"].pop(ticket, None)
                if reservation is None:
                    return
                tokens = getattr(result, "total_tokens", None)
                reason = getattr(error, "reason", "invalid_response") if error else "success"
                if error and isinstance(error, ProviderError) and not error.uncertain:
                    tokens = 0
                if tokens is not None:
                    state["charged"] += tokens - reservation["tokens"]
                    state["estimatedTokens"] -= reservation["tokens"]
                    state["reportedTokens"] += tokens
                state["requests"] += 1
                if error:
                    state["failures"] += 1
                    if reason in {"free_quota_exhausted", "model_unavailable", "invalid_request"}:
                        state["blocked"] = reason
                    elif reason not in {"authentication", "permission"}:
                        state["cooldownUntil"] = now_ms() + (
                            60_000 if reason == "rate_limit" else 30_000
                        )
                else:
                    state["blocked"], state["cooldownUntil"] = "", 0
                if task == "test":
                    state["lastTest"] = {"at": now_ms(), "status": reason}
                doc["events"] = (
                    [
                        {
                            "model": row["id"],
                            "task": task,
                            "status": reason,
                            "at": now_ms(),
                            "tokens": tokens,
                            "estimated": tokens is None,
                            "durationMs": int((time.monotonic() - started) * 1000),
                        }
                    ]
                    + doc["events"]
                )[:50]
                await self.db.set_control(c, self.uid, quota_scope(config), doc)

    async def routed_attempt(self, config, messages, max_tokens, row, ticket, task):
        started = time.monotonic()
        try:
            result = await super().complete(
                replace(config, name=row["id"]), messages, max_tokens, thinking=row["thinking"]
            )
        except BaseException as error:
            await asyncio.shield(self.settle(config, row, ticket, task, started, error=error))
            raise
        await self.settle(config, row, ticket, task, started, result=result)
        return result

    async def complete(self, config, messages, max_tokens=1024, *, task=None, thinking="auto"):
        if task is None:
            return await super().complete(config, messages, max_tokens, thinking=thinking)
        doc = await self.document(config)
        if not doc["config"]["enabled"]:
            return await super().complete(config, messages, max_tokens, thinking=thinking)
        self.validate_provider(config)
        excluded = set()
        last_error = None
        try:
            async with asyncio.timeout(doc["config"]["totalTimeoutSeconds"]):
                for _ in range(doc["config"]["maxAttempts"]):
                    reserved = await self.reserve(
                        config, task, request_reservation(messages, max_tokens), excluded
                    )
                    if reserved is None:
                        break
                    row, ticket = reserved
                    excluded.add(row["id"])
                    try:
                        return await self.routed_attempt(
                            config, messages, max_tokens, row, ticket, task
                        )
                    except ProviderError as error:
                        last_error = error
                        if error.reason in {"authentication", "permission"}:
                            raise
                    except ApiError as error:
                        if error.code not in {502, 504}:
                            raise
                        last_error = error
        except TimeoutError:
            raise ApiError("自动选模已达到总等待上限，请稍后重试", 504) from None
        if last_error:
            raise ApiError("候选模型暂不可用，已记录原因；本次未产生可执行回复", 503)
        raise ApiError("当前任务没有可用的免费模型，请检查额度、到期时间和任务配置", 503)

    async def test_model(self, config, name):
        self.validate_provider(config)
        messages = [{"role": "user", "content": "仅回复 OK"}]
        reserved = await self.reserve(
            config, "test", request_reservation(messages, 512), set(), name
        )
        if not reserved:
            raise ApiError("该模型未启用、额度不足或不支持文本测试", 422)
        row, ticket = reserved
        result = await self.routed_attempt(config, messages, 512, row, ticket, "test")
        return {"model": name, "status": "success", "tokens": result.total_tokens}
