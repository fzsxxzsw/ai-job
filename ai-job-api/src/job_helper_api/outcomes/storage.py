import copy
from contextlib import asynccontextmanager
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from ..config import Settings
from ..database import Database, dumps, loads, now_ms
from ..errors import ApiError
from ..rejection_engine.evidence import redact
from ..rejection_engine.service import digest, snapshot_row
from .contracts import Feedback, ObservationBatch
from .policy import material_key, merge_observation, project


def ident() -> str:
    return str(uuid4())


def phase_values(job, phase: str, now: int) -> dict:
    history = loads(job.get("phase_history_json"), [])
    if not history or history[-1]["phase"] != phase:
        history.append({"phase": phase, "at": now})
    return {"phase": phase, "phase_history_json": dumps(history[-60:]), "updated_at": now}


def task_view(job) -> dict:
    return dict(
        jobId=job["id"],
        caseId=job["case_id"],
        revision=job["revision"],
        status=job["status"],
        phase=job["phase"],
        attempts=job["attempts"],
        nextAttemptAt=job["available_at"] if job["status"] == "RETRY" else None,
        lastErrorCode=job["last_error_code"],
        reportId=job["report_id"],
        createdAt=job["created_at"],
        updatedAt=job["updated_at"],
        phaseHistory=loads(job["phase_history_json"], []),
    )


class OutcomeStorage:
    def __init__(self, db: Database, settings: Settings) -> None:
        self.db, self.settings = db, settings

    @asynccontextmanager
    async def transaction(self, uid: int):
        # One personal owner's short state transitions share lock ordering.
        # The model never runs while this lock/transaction is held.
        if self.settings.read_only:
            raise ApiError("READ_ONLY", 503)
        if not self.settings.outcome_enabled:
            raise ApiError("OUTCOME_DISABLED", 503)
        async with self.db.lock(uid, "outcomes:state"):
            async with self.db.engine.begin() as connection:
                if uid != self.settings.owner_user_id or not await self.db.user(uid, connection):
                    raise ApiError("OWNER_INACTIVE", 403)
                yield connection

    async def row(self, name, uid, value, connection=None):
        table = self.db.table(name)
        return await self.db.one(
            select(table).where(table.c.id == value, table.c.user_id == uid), connection
        )

    async def update(self, name, row, values, connection):
        table = self.db.table(name)
        await connection.execute(
            table.update()
            .where(table.c.id == row["id"], table.c.user_id == row["user_id"])
            .values(**values)
        )
        return {**row, **values}

    async def queue(self, case, facts, projection, connection, now):
        jobs = self.db.table("outcome_job")
        await connection.execute(
            jobs.update()
            .where(
                jobs.c.case_id == case["id"],
                jobs.c.user_id == case["user_id"],
                jobs.c.status.not_in(["COMPLETED", "SUPERSEDED"]),
            )
            .values(status="SUPERSEDED", lease_token=None, lease_until=None, updated_at=now)
        )
        revision = case["revision"] + 1
        values = dict(
            revision=revision,
            facts_json=dumps(facts),
            status="QUEUED",
            next_check_at=projection["nextCheckAt"],
            updated_at=now,
        )
        case = await self.update("outcome_case", case, values, connection)
        await connection.execute(
            jobs.insert().values(
                id=ident(),
                user_id=case["user_id"],
                case_id=case["id"],
                revision=revision,
                status="READY",
                phase="COLLECTING",
                phase_history_json=dumps([{"phase": "COLLECTING", "at": now}]),
                available_at=now,
                attempts=0,
                created_at=now,
                updated_at=now,
            )
        )
        return case

    async def ingest(self, uid: int, batch: ObservationBatch) -> dict:
        accepted, duplicates, cases = [], [], {}
        events, case_table = self.db.table("outcome_observation"), self.db.table("outcome_case")
        async with self.transaction(uid) as connection:
            for item in batch.observations:
                now, payload = now_ms(), item.model_dump()
                fingerprint = digest(payload)
                previous = await self.db.one(
                    select(events).where(
                        events.c.user_id == uid, self.db.exact(events.c.event_id, item.eventId)
                    ),
                    connection,
                )
                if previous:
                    if previous["payload_hash"] != fingerprint:
                        raise ApiError("同一观察编号不能对应不同内容", 409)
                    duplicates.append(item.eventId)
                    existing = await self.row("outcome_case", uid, previous["case_id"], connection)
                    cases[existing["id"]] = existing
                    continue
                key = digest(["boss", uid, item.encryptJobId])
                case = await self.db.one(
                    select(case_table).where(
                        case_table.c.user_id == uid, case_table.c.case_key == key
                    ),
                    connection,
                )
                if item.source == "APPLICATION_FLOW" and not await snapshot_row(
                    self.db, uid, item.encryptJobId, connection
                ):
                    raise ApiError("请先成功保存该岗位的投递快照", 422)
                if not case:
                    case = dict(
                        id=ident(),
                        user_id=uid,
                        case_key=key,
                        encrypt_job_id=item.encryptJobId,
                        conversation_key=None,
                        boss_id=None,
                        revision=0,
                        facts_json="{}",
                        current_report_id=None,
                        status="QUEUED",
                        next_check_at=None,
                        last_observed_at=item.observedAt,
                        last_verified_observation_at=None,
                        created_at=now,
                        updated_at=now,
                    )
                    await connection.execute(case_table.insert().values(**case))
                binding = {}
                for column, incoming in (
                    ("conversation_key", item.conversationKey),
                    ("boss_id", item.bossId),
                ):
                    if incoming and case[column] and incoming != case[column]:
                        raise ApiError("岗位与会话或联系人绑定冲突，不能合并聊天", 409)
                    if incoming and not case[column]:
                        binding[column] = incoming
                old_facts = loads(case["facts_json"], {})
                facts = merge_observation(old_facts, item, now)
                if item.source == "APPLICATION_FLOW":
                    facts.setdefault("applicationObservedAt", item.observedAt)
                projection = project(facts, self.settings, now)
                old_projection = old_facts.get("projection") or project(
                    old_facts, self.settings, now
                )
                material = case["revision"] == 0 or material_key(old_projection) != material_key(
                    projection
                )
                facts["projection"] = projection
                binding.update(
                    last_observed_at=max(case["last_observed_at"], item.observedAt),
                    last_verified_observation_at=(facts.get("coverage") or {}).get("checkedAt"),
                    facts_json=dumps(facts),
                    updated_at=now,
                )
                case = await self.update("outcome_case", case, binding, connection)
                if material:
                    case = await self.queue(case, facts, projection, connection, now)
                safe_payload = copy.deepcopy(payload)
                for message in safe_payload["messages"]:
                    message["text"] = redact(message["text"])
                await connection.execute(
                    events.insert().values(
                        id=ident(),
                        user_id=uid,
                        event_id=item.eventId,
                        case_id=case["id"],
                        payload_hash=fingerprint,
                        source=item.source,
                        observed_at=item.observedAt,
                        received_at=now,
                        payload_json=dumps(safe_payload),
                    )
                )
                accepted.append(item.eventId)
                cases[case["id"]] = case
        return dict(
            acceptedEventIds=accepted,
            duplicateEventIds=duplicates,
            cases=[
                dict(caseId=c["id"], revision=c["revision"], status=c["status"])
                for c in cases.values()
            ],
        )

    async def report_view(self, report, connection: AsyncConnection | None = None) -> dict:
        case = await self.row("outcome_case", report["user_id"], report["case_id"], connection)
        table = self.db.table("outcome_feedback")
        statement = (
            select(table)
            .where(table.c.user_id == report["user_id"], table.c.report_id == report["id"])
            .order_by(table.c.created_at.desc(), table.c.id.desc())
            .limit(50)
        )
        feedback = (
            (await connection.execute(statement)).mappings().all()
            if connection is not None
            else await self.db.rows(statement)
        )
        return {
            **loads(report["report_json"], {}),
            "reportId": report["id"],
            "caseId": report["case_id"],
            "revision": report["revision"],
            "feedbackStatus": report["feedback_status"],
            "isCurrent": bool(case and case["revision"] == report["revision"]),
            "feedbackHistory": [
                dict(
                    feedbackId=item["id"],
                    action=item["action"],
                    correctedOutcome=item["corrected_outcome"],
                    correctedReason=item["corrected_reason"],
                    createdAt=item["created_at"],
                )
                for item in feedback
            ],
        }

    async def case_view(self, case) -> dict:
        jobs = self.db.table("outcome_job")
        task = await self.db.one(
            select(jobs).where(
                jobs.c.user_id == case["user_id"],
                jobs.c.case_id == case["id"],
                jobs.c.revision == case["revision"],
            )
        )
        report = (
            await self.row("outcome_report", case["user_id"], case["current_report_id"])
            if case["current_report_id"]
            else None
        )
        projection = loads(case["facts_json"], {}).get("projection", {})
        return dict(
            caseId=case["id"],
            encryptJobId=case["encrypt_job_id"],
            conversationKey=case["conversation_key"],
            bossId=case["boss_id"],
            revision=case["revision"],
            status=case["status"],
            nextCheckAt=case["next_check_at"],
            lastObservedAt=case["last_observed_at"],
            outcome=projection.get("outcome", "UNKNOWN"),
            readState=projection.get("readState", "UNKNOWN"),
            waitingOn=projection.get("waitingOn", "UNKNOWN"),
            report=await self.report_view(report) if report else None,
            task=task_view(task) if task else None,
        )

    async def listing(self, uid, *, tasks=False, case_id=None, limit=20, offset=0):
        table = self.db.table("outcome_job" if tasks else "outcome_case")
        where = table.c.user_id == uid
        if case_id and tasks:
            where &= table.c.case_id == case_id
        count = await self.db.one(
            select(func.count().label("total")).select_from(table).where(where)
        )
        rows = await self.db.rows(
            select(table)
            .where(where)
            .order_by(table.c.updated_at.desc(), table.c.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return {
            "items": [task_view(row) for row in rows]
            if tasks
            else [await self.case_view(row) for row in rows],
            "total": count["total"],
        }

    async def detail(self, uid: int, value: str, *, tasks: bool = False) -> dict:
        row = await self.row("outcome_job" if tasks else "outcome_case", uid, value)
        if not row:
            raise ApiError("记录不存在或不属于当前用户", 404)
        return task_view(row) if tasks else await self.case_view(row)

    async def history(self, uid: int, case_id: str) -> dict:
        if not await self.row("outcome_case", uid, case_id):
            raise ApiError("记录不存在或不属于当前用户", 404)
        table = self.db.table("outcome_report")
        rows = await self.db.rows(
            select(table)
            .where(table.c.user_id == uid, table.c.case_id == case_id)
            .order_by(table.c.revision.desc())
            .limit(50)
        )
        return {"reports": [await self.report_view(row) for row in rows]}

    async def feedback(self, uid: int, report_id: str, payload: Feedback) -> dict:
        table, jobs = self.db.table("outcome_feedback"), self.db.table("outcome_job")
        fingerprint = digest([report_id, payload.model_dump()])
        async with self.transaction(uid) as connection:
            report = await self.row("outcome_report", uid, report_id, connection)
            if not report:
                raise ApiError("报告不存在或不属于当前用户", 404)
            previous = await self.db.one(
                select(table).where(
                    table.c.user_id == uid, self.db.exact(table.c.request_id, payload.requestId)
                ),
                connection,
            )
            if previous:
                if previous["payload_hash"] != fingerprint:
                    raise ApiError("同一反馈编号不能对应不同内容", 409)
                return await self.report_view(report, connection)
            now, feedback_id = now_ms(), ident()
            await connection.execute(
                table.insert().values(
                    id=feedback_id,
                    user_id=uid,
                    report_id=report_id,
                    request_id=payload.requestId,
                    payload_hash=fingerprint,
                    action=payload.action,
                    corrected_outcome=payload.correctedOutcome,
                    corrected_reason=redact(payload.correctedReason)
                    if payload.correctedReason
                    else None,
                    created_at=now,
                )
            )
            report = await self.update(
                "outcome_report",
                report,
                {
                    "feedback_status": {
                        "CONFIRM": "CONFIRMED",
                        "CORRECT": "CORRECTED",
                        "IGNORE": "IGNORED",
                    }[payload.action],
                    "updated_at": now,
                },
                connection,
            )
            case = await self.row("outcome_case", uid, report["case_id"], connection)
            if case["revision"] == report["revision"]:
                job = await self.db.one(
                    select(jobs).where(
                        jobs.c.user_id == uid,
                        jobs.c.case_id == case["id"],
                        jobs.c.revision == case["revision"],
                    ),
                    connection,
                )
                if (
                    job
                    and not job["feedback_id"]
                    and job["status"] not in {"COMPLETED", "SUPERSEDED", "FAILED"}
                ):
                    values = {"feedback_id": feedback_id, "updated_at": now}
                    if job["status"] == "WAITING_CONFIRMATION":
                        values.update(status="CONFIRMATION_READY", available_at=now)
                    await self.update("outcome_job", job, values, connection)
            return await self.report_view(report, connection)
