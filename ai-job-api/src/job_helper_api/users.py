import asyncio
import json
import re
import sys
from collections.abc import Mapping
from typing import Any

from .contracts import ConfigInput, PreferenceInput
from .database import Database, dumps, loads, now_date, now_ms
from .errors import ApiError
from .execution_authority import bump_authority
from .model import MASKED_KEY, ModelClient, row_config

CONFIG_FIELDS = {
    "provider": "provider",
    "modelName": "model_name",
    "apiKey": "api_key",
    "baseUrl": "base_url",
    "completionsPath": "completions_path",
    "timeout": "timeout",
    "status": "status",
    "userPrompt": "user_prompt",
}


async def user_view(db: Database, uid: int) -> dict[str, Any]:
    user, resume = await db.user(uid), await db.resume(uid)
    if not user:
        raise ApiError("当前账号不存在", 401)
    return {
        "id": user["id"],
        "phone": user["phone"],
        "email": user["email"],
        "preference": loads(user["preference"], {}),
        "aiSeatStatus": user["ai_seat_status"] == 1,
        "resumeId": resume["resume_id"] if resume else None,
        "inviteCode": user["invite_code"],
        "bindInviteCode": user["bind_invite_code"],
    }


async def save_preference(db: Database, uid: int, payload: PreferenceInput) -> None:
    values = {"updated_id": uid, "updated_date": now_date()}
    if "preference" in payload.model_fields_set and payload.preference is not None:
        serialized = dumps(payload.preference)
        if len(serialized.encode()) > 60000:
            raise ApiError("偏好设置过大")
        values["preference"] = serialized
    for key in ("phone", "email"):
        value = getattr(payload, key)
        if value is not None:
            values[key] = value
    if payload.aiSeatStatus is not None:
        values["ai_seat_status"] = int(payload.aiSeatStatus)
    t = db.table("user_info")
    async with db.engine.begin() as c:
        await bump_authority(db, c, uid)
        await c.execute(t.update().where(t.c.id == uid, t.c.is_active.is_(True)).values(**values))


async def parse_pdf(data: bytes) -> str:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "job_helper_api.pdf_worker",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        out, _ = await asyncio.wait_for(process.communicate(data), timeout=12)
    except TimeoutError:
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise ApiError("简历解析超时，原简历未修改", 422) from None
    except asyncio.CancelledError:
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode or len(out) > 800000:
        raise ApiError("PDF无效或没有可提取文字，原简历未修改", 422)
    try:
        text = json.loads(out)["text"]
        if not isinstance(text, str) or not text.strip():
            raise ValueError()
        return text
    except (ValueError, KeyError, TypeError):
        raise ApiError("PDF解析结果无效，原简历未修改", 422) from None


async def save_resume(db: Database, uid: int, text: str, resume_id: str) -> dict[str, str]:
    if len(text.encode("utf-8")) > 60000:
        raise ApiError("简历文字超过数据库安全长度，请精简后导入，原简历未修改", 422)
    phone = re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", text)
    email = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
    result = {"phone": phone.group() if phone else "", "email": email.group() if email else ""}
    if len(result["email"]) > 56:
        result["email"] = ""
    t, u = db.table("user_resume"), db.table("user_info")
    async with db.lock(uid, "resume"):
        async with db.engine.begin() as c:
            await bump_authority(db, c, uid)
            await c.execute(
                t.update()
                .where(t.c.user_id == uid, t.c.is_active.is_(True))
                .values(is_active=False, updated_id=uid, updated_date=now_date())
            )
            await c.execute(
                t.insert().values(
                    user_id=uid,
                    resume_content=text,
                    resume_id=resume_id,
                    is_active=True,
                    created_id=uid,
                    updated_id=uid,
                    created_date=now_date(),
                    updated_date=now_date(),
                )
            )
            values = {k: v for k, v in result.items() if v}
            if values:
                await c.execute(
                    u.update()
                    .where(u.c.id == uid)
                    .values(**values, updated_date=now_date(), updated_id=uid)
                )
    return result


def config_view(row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "userId": row["user_id"],
        **{
            public: row.get(column)
            for public, column in CONFIG_FIELDS.items()
            if public != "apiKey"
        },
        "apiKey": MASKED_KEY if row.get("api_key") else "",
        "apiKeyConfigured": bool(row.get("api_key")),
        "testPassed": row["test_passed"],
    }


def merge_config(
    existing: Mapping[str, Any] | None, payload: ConfigInput, uid: int
) -> dict[str, Any]:
    # The Chrome form initializes userId=0 before its first configuration exists.
    # This is only a placeholder: every read/write still uses the session's uid.
    if payload.userId not in (None, 0, uid) or (
        payload.id is not None and (not existing or payload.id != existing["id"])
    ):
        raise ApiError("无权修改其他账号的AI配置", 403)
    value = (
        dict(existing)
        if existing
        else {"provider": 0, "api_key": "", "status": 0, "timeout": 15, "test_passed": 0}
    )
    for key in payload.model_fields_set:
        if key not in CONFIG_FIELDS:
            continue
        v = getattr(payload, key)
        if v is None:
            continue
        if key == "apiKey" and v in ("", MASKED_KEY):
            continue
        value[CONFIG_FIELDS[key]] = v
    return value


async def save_config(
    db: Database, model: ModelClient, uid: int, payload: ConfigInput, temporary: bool = False
) -> bool:
    async with db.lock(uid, "config"):
        old = await db.ai_config(uid)
        merged = merge_config(old, payload, uid)
        changed = not old or row_config(old).fingerprint() != row_config(merged).fingerprint()
        proof = await db.control(uid, "model-test:" + row_config(merged).fingerprint(), 0)
        tested = proof > now_ms() - 3600000 or (old and not changed and old.get("test_passed") == 1)
        if not temporary and merged.get("status") == 1 and not tested:
            raise ApiError("模型配置未通过服务端测试，请先测试后再启用", 400)
        merged["test_passed"] = int(bool(tested))
        if temporary and changed:
            # A draft cannot silently replace an enabled, verified model.
            merged["test_passed"] = 0
            merged["status"] = 0
        values = {k: merged.get(k) for k in set(CONFIG_FIELDS.values()) if k in merged}
        values.update(test_passed=merged["test_passed"], updated_id=uid, updated_date=now_date())
        t = db.table("user_ai_config")
        async with db.engine.begin() as c:
            await bump_authority(db, c, uid)
            if old:
                await c.execute(
                    t.update().where(t.c.id == old["id"], t.c.user_id == uid).values(**values)
                )
            else:
                await c.execute(
                    t.insert().values(
                        **values,
                        user_id=uid,
                        is_active=True,
                        created_id=uid,
                        created_date=now_date(),
                    )
                )
        return True
