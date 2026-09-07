"""Durable user-scoped reports using the API's shared database and model client."""

import hashlib
import json

from sqlalchemy import select

from ..database import dumps, now_ms
from ..errors import ApiError
from ..model import effective_config
from .evidence import build_evidence, redact
from .reviewer import PROMPT, merge_findings, validated_findings
from .rules import ALLOWED_CODES, PROMPT_VERSION, TAXONOMY_VERSION, analyze_rules

MAX_MODEL_EVIDENCE_CHARACTERS = 256000


def digest(value: object) -> str:
    return hashlib.sha256(dumps(value).encode("utf-8")).hexdigest()


def report_view(row) -> dict:
    try:
        value = json.loads(row["analysis_json"])
        if not isinstance(value, dict):
            raise ValueError()
    except (TypeError, ValueError):
        raise ApiError("历史分析记录格式异常，请保留记录并检查", 422) from None
    result = {
        key: value.get(key, [])
        for key in ("explicitReasons", "inferredRisks", "unknowns", "suggestions", "evidence")
    }
    if not all(isinstance(item, list) for item in result.values()):
        raise ApiError("历史分析记录格式异常，请保留记录并检查", 422)
    result.update(
        id=row["id"],
        applicationSnapshotId=row["application_snapshot_id"],
        status=row["status"],
        analysisSource=row["analysis_source"],
        conversationCompleteness=row["conversation_completeness"],
        model=row["model"],
        promptVersion=row["prompt_version"],
        taxonomyVersion=TAXONOMY_VERSION,
        createdAt=row["created_at"],
        correctedReason=row["corrected_reason"],
    )
    return result


def snapshot_view(row) -> dict:
    return {
        "id": row["id"],
        "encryptJobId": row["encrypt_job_id"],
        "appliedAt": row["applied_at"],
        "resumeRecordId": row["resume_record_id"],
        "resumeHash": row["resume_hash"],
        "jdHash": row["jd_hash"],
        "createdAt": row["created_at"],
    }


async def snapshot_row(db, uid: int, job: str, connection=None):
    table = db.table("job_application_snapshot")
    return await db.one(
        select(table)
        .where(table.c.user_id == uid, db.exact(table.c.encrypt_job_id, job))
        .order_by(table.c.id.desc())
        .limit(1),
        connection,
    )


async def save_snapshot(db, uid: int, payload) -> dict:
    table = db.table("job_application_snapshot")
    async with db.lock(uid, "snapshot:" + payload.encryptJobId):
        async with db.engine.begin() as connection:
            prior = await snapshot_row(db, uid, payload.encryptJobId, connection)
            if prior:
                return snapshot_view(prior)
            now = now_ms()
            if not now - 300_000 <= payload.appliedAt <= now + 60_000:
                raise ApiError("不能用当前简历补造历史投递快照；历史拒绝仍可仅分析对话", 422)
            resume, user = await db.resume(uid, connection), await db.user(uid, connection)
            if not user:
                raise ApiError("账号已停用", 403)
            if not resume or not resume["resume_content"]:
                raise ApiError("没有可保存的简历快照，请先导入简历", 422)
            values = dict(
                user_id=uid,
                encrypt_job_id=payload.encryptJobId,
                applied_at=payload.appliedAt,
                job_base_info=payload.jobBaseInfo,
                job_ext_info=payload.jobExtInfo,
                jd_hash=digest([payload.jobBaseInfo, payload.jobExtInfo]),
                resume_record_id=resume["id"],
                resume_content=resume["resume_content"],
                resume_hash=digest(resume["resume_content"]),
                preference_snapshot=user["preference"],
                pre_match_result=dumps(payload.preMatchResult),
                created_at=now,
            )
            inserted = await connection.execute(table.insert().values(**values))
            return snapshot_view({**values, "id": inserted.inserted_primary_key[0]})


async def analyze(db, model, settings, uid: int, payload) -> dict:
    table = db.table("rejection_analysis")
    messages = [
        {"role": message.role, "text": redact(message.text)} for message in payload.messages
    ]
    if not any(message["role"] == "HR" and message["text"] for message in messages):
        raise ApiError("当前资料没有HR原话，不能判断拒绝原因", 422)
    conversation_ref = "rj:" + digest([uid, payload.conversationKey])
    fingerprint = digest(
        [
            "rejection-v1",
            uid,
            payload.encryptJobId,
            conversation_ref,
            [(message["role"], " ".join(message["text"].split())) for message in messages],
        ]
    )
    async with db.lock(uid, "rejection:" + fingerprint):
        prior = await db.one(
            select(table)
            .where(
                table.c.user_id == uid,
                db.exact(table.c.encrypt_job_id, payload.encryptJobId),
                table.c.conversation_hash == fingerprint,
            )
            .order_by(table.c.id.desc())
            .limit(1)
        )
        if prior:
            return report_view(prior)
        snapshot = await snapshot_row(db, uid, payload.encryptJobId)
        evidence = build_evidence(messages, snapshot)
        report = analyze_rules(evidence)
        source, model_name = "RULES_ONLY", "none"
        try:
            model_evidence = dumps(evidence)
            if len(model_evidence) > MAX_MODEL_EVIDENCE_CHARACTERS:
                report["unknowns"].append(
                    "证据正文已保留；总量超过本次模型输入上限，已使用规则分析"
                )
            else:
                config = effective_config(settings, await db.ai_config(uid))
                answer = await model.complete(
                    config,
                    [
                        {"role": "system", "content": PROMPT},
                        {"role": "user", "content": model_evidence},
                    ],
                    max_tokens=2400,
                    task="analysis",
                )
                accepted = validated_findings(answer, evidence)
                if accepted:
                    report = merge_findings(report, accepted)
                    source, model_name = "RULES_AI", getattr(answer, "model_name", config.name)
                else:
                    report["unknowns"].append("模型未提供通过证据校验的新结论，本次仅使用规则分析")
        except ApiError:
            report["unknowns"].append("模型不可用或输出未通过证据校验，本次仅使用规则分析")
        values = dict(
            user_id=uid,
            application_snapshot_id=snapshot["id"] if snapshot else None,
            encrypt_job_id=payload.encryptJobId,
            conversation_key=conversation_ref,
            conversation_completeness="POSSIBLY_INCOMPLETE",
            conversation_json=dumps(messages),
            conversation_hash=fingerprint,
            analysis_json=dumps(report),
            status="PENDING",
            analysis_source=source,
            model=model_name,
            prompt_version=PROMPT_VERSION,
            corrected_reason=None,
            corrected_code=None,
            created_at=now_ms(),
            updated_at=now_ms(),
        )
        # No long-lived DB transaction is held while the model is running.
        async with db.engine.begin() as connection:
            if not await db.user(uid, connection):
                raise ApiError("账号已停用", 403)
            inserted = await connection.execute(table.insert().values(**values))
        return report_view({**values, "id": inserted.inserted_primary_key[0]})


async def get_report(db, uid: int, ident: int) -> dict:
    table = db.table("rejection_analysis")
    row = await db.one(select(table).where(table.c.id == ident, table.c.user_id == uid))
    if not row:
        raise ApiError("分析记录不存在或不属于当前用户", 404)
    return report_view(row)


async def feedback(db, uid: int, ident: int, payload) -> dict:
    table = db.table("rejection_analysis")
    async with db.lock(uid, "feedback:" + str(ident)):
        async with db.engine.begin() as connection:
            row = await db.one(
                select(table).where(table.c.id == ident, table.c.user_id == uid).with_for_update(),
                connection,
            )
            if not row:
                raise ApiError("分析记录不存在或不属于当前用户", 404)
            report_view(row)
            values = dict(
                status={"CONFIRM": "CONFIRMED", "CORRECT": "CORRECTED", "IGNORE": "IGNORED"}[
                    payload.action
                ],
                updated_at=now_ms(),
                corrected_reason=None,
                corrected_code=None,
            )
            if payload.action == "CORRECT":
                if not payload.correctedReason or not payload.correctedReason.strip():
                    raise ApiError("请填写纠正原因", 422)
                code = (payload.correctedCode or "USER_CORRECTION").upper()
                values.update(
                    corrected_reason=redact(payload.correctedReason),
                    corrected_code=code if code in ALLOWED_CODES else "USER_CORRECTION",
                )
            await connection.execute(
                table.update().where(table.c.id == ident, table.c.user_id == uid).values(**values)
            )
            return report_view({**row, **values})


async def summary(db, uid: int) -> dict:
    table = db.table("rejection_analysis")
    rows = await db.rows(
        select(table).where(table.c.user_id == uid, table.c.status.in_(["CONFIRMED", "CORRECTED"]))
    )
    counts: dict[str, int] = {}
    for row in rows:
        report = report_view(row)
        if row["status"] == "CORRECTED":
            codes = {row["corrected_code"] or "USER_CORRECTION"}
        else:
            codes = {
                item.get("code", "UNKNOWN")
                for item in report["explicitReasons"] + report["inferredRisks"]
                if isinstance(item, dict)
            }
        for code in codes or {"UNKNOWN"}:
            counts[code] = counts.get(code, 0) + 1
    return {
        "visible": len(rows) >= 5,
        "totalConfirmed": len(rows),
        "categoryCounts": counts if len(rows) >= 5 else {},
    }


async def history(db, uid: int) -> list[dict]:
    table = db.table("rejection_analysis")
    rows = await db.rows(
        select(table)
        .where(table.c.user_id == uid)
        .order_by(table.c.created_at.desc(), table.c.id.desc())
        .limit(20)
    )
    return [
        {
            "id": row["id"],
            "status": row["status"],
            "analysisSource": row["analysis_source"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]
