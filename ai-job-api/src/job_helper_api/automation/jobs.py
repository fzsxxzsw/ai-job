from sqlalchemy import String, cast, exists, func, literal, or_, select

from ..database import dumps, loads, now_ms
from ..errors import ApiError
from ..outcomes.storage import task_view
from .storage import TERMINAL, Storage, digest, identifier

UNCERTAIN_REVIEW_PREFIX = "automation:uncertain-review:"


class Jobs(Storage):
    def review_key(self, job):
        return UNCERTAIN_REVIEW_PREFIX + job["id"] + ":" + str(job["updated_at"])

    def reviewed_exists(self):
        controls = self.db.table("py_api_control")
        return exists(
            select(controls.c.user_id).where(
                controls.c.user_id == self.jobs.c.user_id,
                controls.c.control_key
                == literal(UNCERTAIN_REVIEW_PREFIX)
                + self.jobs.c.id
                + literal(":")
                + cast(self.jobs.c.updated_at, String),
            )
        )

    async def reviewed_view(self, uid, job, c=None):
        view = await self.view(uid, job, c)
        review = await self.db.control(uid, self.review_key(job), None, c)
        view["reviewedAt"] = review.get("reviewedAt") if isinstance(review, dict) else None
        return view

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

    async def listing(
        self, uid, limit=20, offset=0, kind=None, conversation_key=None, active_only=False
    ):
        query = select(self.jobs).where(self.jobs.c.user_id == uid)
        if active_only:
            query = query.where(
                self.jobs.c.status.not_in(TERMINAL),
                or_(self.jobs.c.status != "UNCERTAIN", ~self.reviewed_exists()),
            )
        if kind:
            query = query.where(self.jobs.c.kind == kind)
        if conversation_key:
            query = query.where(self.db.exact(self.jobs.c.conversation_key, conversation_key))
        rows = await self.db.rows(
            query.order_by(self.jobs.c.created_at.desc()).limit(limit).offset(offset)
        )
        if not rows:
            return []
        uncertain_rows = [row for row in rows if row["status"] == "UNCERTAIN"]
        review_rows = []
        if uncertain_rows:
            controls = self.db.table("py_api_control")
            review_rows = await self.db.rows(
                select(controls.c.control_key, controls.c.value_json).where(
                    controls.c.user_id == uid,
                    controls.c.control_key.in_([self.review_key(row) for row in uncertain_rows]),
                )
            )
        reviews = {row["control_key"]: loads(row["value_json"]) for row in review_rows}
        views = []
        for row in rows:
            job = dict(row)
            view = await self.view(uid, job)
            review = reviews.get(self.review_key(job))
            view["reviewedAt"] = review.get("reviewedAt") if isinstance(review, dict) else None
            views.append(view)
        return views

    async def detail(self, uid, job_id):
        return await self.reviewed_view(uid, await self.row(self.jobs, uid, job_id))

    async def review(self, uid, job_id, payload):
        async with self.transaction(uid) as c:
            job = await self.row(self.jobs, uid, job_id, c)
            if job["status"] != "UNCERTAIN":
                raise ApiError("JOB_NOT_UNCERTAIN", 409)
            _, repeated = await self.event(
                c,
                uid,
                payload.requestId,
                "UNCERTAIN_REVIEW",
                {"jobId": job_id, "reviewed": payload.reviewed},
                job_id,
            )
            if not repeated:
                key = self.review_key(job)
                if payload.reviewed:
                    current = await self.db.control(uid, key, None, c)
                    if current is None:
                        await self.db.set_control(
                            c, uid, key, {"reviewedAt": now_ms(), "resolution": "UNVERIFIED"}
                        )
                else:
                    controls = self.db.table("py_api_control")
                    await c.execute(
                        controls.delete().where(
                            controls.c.user_id == uid, controls.c.control_key == key
                        )
                    )
            return await self.reviewed_view(uid, job, c)

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
        jobs = await self.db.rows(
            select(self.jobs.c.status, func.count().label("total"))
            .where(self.jobs.c.user_id == uid)
            .group_by(self.jobs.c.status)
        )
        reviewed_count = 0
        if any(row["status"] == "UNCERTAIN" for row in jobs):
            reviewed_count = (
                await self.db.one(
                    select(func.count().label("total"))
                    .select_from(self.jobs)
                    .where(
                        self.jobs.c.user_id == uid,
                        self.jobs.c.status == "UNCERTAIN",
                        self.reviewed_exists(),
                    )
                )
            )["total"]
        counts = {
            "queued": 0,
            "running": 0,
            "waitingExecution": 0,
            "waitingConfirmation": 0,
            "uncertain": 0,
            "reviewedUncertain": 0,
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
                reviewed = reviewed_count if row["status"] == "UNCERTAIN" else 0
                counts[mapping[row["status"]]] += int(row["total"]) - reviewed
                counts["reviewedUncertain"] += reviewed
        worker = await self.db.control(uid, "automation:worker", {})
        executor = await self.db.control(uid, "automation:executor-latest", {})

        def state(last):
            return "OFFLINE" if not last else "READY" if now_ms() - last < 60000 else "STALE"

        cases = self.db.table("outcome_case")
        reports = self.db.table("outcome_report")
        case_summary = await self.db.one(
            select(
                func.count().label("case_count"),
                func.max(cases.c.last_observed_at).label("last_observed"),
            ).where(cases.c.user_id == uid)
        )
        report_summary = await self.db.one(
            select(func.count().label("report_count")).where(reports.c.user_id == uid)
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
                "caseCount": case_summary["case_count"],
                "reportCount": report_summary["report_count"],
                "lastObservedAt": case_summary["last_observed"],
                "tasks": {
                    "counts": outcome_counts,
                    "total": sum(outcome_counts.values()),
                    "items": [task_view(row) for row in recent_outcome_jobs],
                },
            },
            "buildId": self.settings.build_id,
        }
