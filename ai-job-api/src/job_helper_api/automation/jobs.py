from sqlalchemy import func, select

from ..database import dumps, loads, now_ms
from ..errors import ApiError
from ..outcomes.storage import task_view
from .storage import TERMINAL, Storage, digest, identifier


class Jobs(Storage):
    async def submit(self, uid, payload):
        raw = payload.model_dump(mode="json")
        if (
            payload.kind == "REPLY"
            and payload.input.inboundSentAt
            and payload.input.inboundSentAt > now_ms() + 60000
        ):
            raise ApiError("INVALID_EVENT_TIME", 422)
        async with self.transaction(uid) as c:
            await self.account(uid, payload.platformAccount, c)
            existing_request = await self.db.one(
                select(self.events).where(
                    self.events.c.user_id == uid,
                    self.db.exact(self.events.c.request_id, payload.requestId),
                ),
                c,
            )
            if existing_request:
                await self.event(c, uid, payload.requestId, "JOB_REQUEST", raw)
                return await self.view(
                    uid, await self.row(self.jobs, uid, existing_request["job_id"], c), c
                )
            identity = (
                payload.input.inboundMessageId
                if payload.kind == "REPLY"
                else payload.input.cycleKey
            )
            business_key = digest(
                [
                    payload.kind,
                    payload.platformAccount,
                    payload.encryptJobId,
                    payload.conversationKey if payload.kind == "REPLY" else None,
                    identity,
                ]
            )
            previous = await self.db.one(
                select(self.jobs).where(
                    self.jobs.c.user_id == uid, self.jobs.c.business_key == business_key
                ),
                c,
            )
            if previous:
                previous_raw = loads(previous["input_json"], {})
                # Request IDs are transport identity; stable platform MID/cycle is business identity.
                if digest({k: v for k, v in raw.items() if k != "requestId"}) != digest(
                    {k: v for k, v in previous_raw.items() if k != "requestId"}
                ):
                    raise ApiError("REQUEST_CONFLICT", 409)
                await self.event(c, uid, payload.requestId, "JOB_REQUEST", raw, previous["id"])
                return await self.view(uid, dict(previous), c)
            revision = 1
            uncertain_order = False
            if payload.kind == "REPLY":
                active = (
                    (
                        await c.execute(
                            select(self.jobs)
                            .where(
                                self.jobs.c.user_id == uid,
                                self.jobs.c.kind == "REPLY",
                                self.db.exact(
                                    self.jobs.c.platform_account, payload.platformAccount
                                ),
                                self.db.exact(
                                    self.jobs.c.conversation_key, payload.conversationKey
                                ),
                            )
                            .order_by(self.jobs.c.created_at.desc())
                        )
                    )
                    .mappings()
                    .all()
                )
                revision = max((j["revision"] for j in active), default=0) + 1
                new_time = payload.input.inboundSentAt
                known_times = [
                    loads(j["input_json"], {}).get("input", {}).get("inboundSentAt") for j in active
                ]
                known = [t for t in known_times if t is not None]
                if new_time is not None and known and new_time < max(known):
                    raise ApiError("INBOUND_ORDER_UNCERTAIN", 409)
                uncertain_order = bool(
                    active
                    and (
                        new_time is None
                        or any(t is None for t in known_times)
                        or (known and new_time == max(known))
                    )
                )
                for old_row in active:
                    old = dict(old_row)
                    if old["status"] in TERMINAL:
                        continue
                    for action in await self.action_rows(uid, old["id"], c):
                        if action["status"] in {"QUEUED", "LEASED"}:
                            await self.update_action(
                                c, action, status="CANCELLED", last_error_code="INPUT_CHANGED"
                            )
                    state = "UNCERTAIN" if uncertain_order else "SUPERSEDED"
                    await self.update_job(
                        c,
                        old,
                        status=state,
                        phase=state,
                        last_error_code="INBOUND_ORDER_UNCERTAIN"
                        if uncertain_order
                        else "INPUT_CHANGED",
                        lease_token=None,
                        lease_until=None,
                    )
            context = await self.freeze(uid, payload, c)
            timestamp = now_ms()
            job = dict(
                id=identifier(),
                user_id=uid,
                business_key=business_key,
                kind=payload.kind,
                platform_account=payload.platformAccount,
                conversation_key=payload.conversationKey,
                encrypt_job_id=payload.encryptJobId,
                boss_id=payload.bossId,
                revision=revision,
                input_hash=digest([raw, context]),
                input_json=dumps(raw),
                context_json=dumps(context),
                status="UNCERTAIN" if uncertain_order else "READY",
                phase="UNCERTAIN" if uncertain_order else "QUEUED",
                phase_history_json=dumps(
                    [{"phase": "UNCERTAIN" if uncertain_order else "QUEUED", "at": timestamp}]
                ),
                available_at=timestamp,
                lease_token=None,
                lease_until=None,
                attempts=0,
                compute_started=0,
                graph_finalized=1,
                artifact_id=None,
                artifact_json=None,
                validation_hash=None,
                result_json=None,
                result_id=None,
                last_error_code="INBOUND_ORDER_UNCERTAIN" if uncertain_order else None,
                created_at=timestamp,
                updated_at=timestamp,
            )
            await c.execute(self.jobs.insert().values(**job))
            await self.event(c, uid, payload.requestId, "JOB_REQUEST", raw, job["id"])
            return await self.view(uid, job, c)

    async def listing(self, uid, limit=20, offset=0, kind=None, conversation_key=None):
        query = select(self.jobs).where(self.jobs.c.user_id == uid)
        if kind:
            query = query.where(self.jobs.c.kind == kind)
        if conversation_key:
            query = query.where(self.db.exact(self.jobs.c.conversation_key, conversation_key))
        rows = await self.db.rows(
            query.order_by(self.jobs.c.created_at.desc()).limit(limit).offset(offset)
        )
        return [await self.view(uid, dict(row)) for row in rows]

    async def detail(self, uid, job_id):
        return await self.view(uid, await self.row(self.jobs, uid, job_id))

    async def cancel(self, uid, job_id, payload):
        async with self.transaction(uid) as c:
            job = await self.row(self.jobs, uid, job_id, c)
            _, repeated = await self.event(
                c, uid, payload.requestId, "CANCEL", {"jobId": job_id}, job_id
            )
            if not repeated and job["status"] not in TERMINAL:
                for action in await self.action_rows(uid, job_id, c):
                    if action["status"] in {"QUEUED", "LEASED"}:
                        await self.update_action(c, action, status="CANCELLED")
                await self.update_job(
                    c,
                    job,
                    status="CANCELLED",
                    phase="CANCELLED",
                    lease_token=None,
                    lease_until=None,
                )
            return await self.view(uid, job, c)

    async def status(self, uid):
        jobs = await self.db.rows(select(self.jobs.c.status).where(self.jobs.c.user_id == uid))
        counts = {
            "queued": 0,
            "running": 0,
            "waitingExecution": 0,
            "waitingConfirmation": 0,
            "uncertain": 0,
            "failed": 0,
            "completed": 0,
        }
        mapping = {
            "READY": "queued",
            "RETRY": "queued",
            "RUNNING": "running",
            "WAITING_EXECUTION": "waitingExecution",
            "EXECUTION_READY": "waitingExecution",
            "WAITING_CONFIRMATION": "waitingConfirmation",
            "CONFIRMATION_READY": "waitingConfirmation",
            "UNCERTAIN": "uncertain",
            "FAILED": "failed",
            "COMPLETED": "completed",
        }
        for row in jobs:
            if row["status"] in mapping:
                counts[mapping[row["status"]]] += 1
        worker = await self.db.control(uid, "automation:worker", {})
        executor = await self.db.control(uid, "automation:executor-latest", {})

        def state(last):
            return "OFFLINE" if not last else "READY" if now_ms() - last < 60000 else "STALE"

        cases = await self.db.rows(
            select(self.db.table("outcome_case").c.last_observed_at).where(
                self.db.table("outcome_case").c.user_id == uid
            )
        )
        reports = await self.db.rows(
            select(self.db.table("outcome_report").c.id).where(
                self.db.table("outcome_report").c.user_id == uid
            )
        )
        outcome_jobs = self.db.table("outcome_job")
        outcome_counts = {
            row["status"]: row["total"]
            for row in await self.db.rows(
                select(outcome_jobs.c.status, func.count().label("total"))
                .where(outcome_jobs.c.user_id == uid)
                .group_by(outcome_jobs.c.status)
            )
        }
        recent_outcome_jobs = await self.db.rows(
            select(outcome_jobs)
            .where(outcome_jobs.c.user_id == uid)
            .order_by(outcome_jobs.c.updated_at.desc(), outcome_jobs.c.id.desc())
            .limit(10)
        )
        return {
            "contractVersion": 1,
            "enabled": self.settings.automation_enabled,
            "mode": "LANGGRAPH" if self.settings.automation_enabled else "LEGACY",
            "agent": {
                "state": state(worker.get("lastSeenAt")),
                "lastSeenAt": worker.get("lastSeenAt"),
                "lastCompletedAt": worker.get("lastCompletedAt"),
                "lastErrorCode": worker.get("lastErrorCode"),
            },
            "executor": {
                "state": state(executor.get("lastSeenAt")),
                "lastSeenAt": executor.get("lastSeenAt"),
            },
            "counts": counts,
            "outcomes": {
                "enabled": self.settings.outcome_enabled,
                "caseCount": len(cases),
                "reportCount": len(reports),
                "lastObservedAt": max((r["last_observed_at"] for r in cases), default=None),
                "tasks": {
                    "counts": outcome_counts,
                    "total": sum(outcome_counts.values()),
                    "items": [task_view(row) for row in recent_outcome_jobs],
                },
            },
            "buildId": self.settings.build_id,
        }
