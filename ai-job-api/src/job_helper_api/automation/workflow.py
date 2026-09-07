from sqlalchemy import or_, select

from ..database import dumps, loads, now_ms
from ..errors import ApiError
from .computation import compute, validate_artifact
from .storage import Storage, digest, identifier, token


class Workflow(Storage):
    async def heartbeat(self, payload):
        async with self.transaction(self.uid) as c:
            state = await self.db.control(self.uid, "automation:worker", {}, c)
            state.update(payload.model_dump(), lastSeenAt=now_ms())
            await self.db.set_control(c, self.uid, "automation:worker", state)
            pending = (
                await c.execute(
                    select(self.jobs)
                    .where(
                        self.jobs.c.user_id == self.uid,
                        self.jobs.c.status.in_(
                            ["WAITING_EXECUTION", "WAITING_CONFIRMATION", "UNCERTAIN"]
                        ),
                    )
                    .limit(200)
                )
            ).mappings()
            for row in pending:
                job = dict(row)
                await self.expire_actions(c, self.uid, job)
                await self.wake(c, job)
            return {key: state[key] for key in ("workerId", "graphVersion", "lastSeenAt")}

    async def claim(self, payload):
        async with self.transaction(self.uid) as c:
            candidates = (
                (
                    await c.execute(
                        select(self.jobs)
                        .where(
                            self.jobs.c.user_id == self.uid,
                            or_(
                                self.jobs.c.status.in_(
                                    ["READY", "RETRY", "EXECUTION_READY", "CONFIRMATION_READY"]
                                ),
                                (self.jobs.c.status == "RUNNING")
                                & (self.jobs.c.lease_until < now_ms()),
                                self.jobs.c.status.in_(["COMPLETED", "FAILED"])
                                & (self.jobs.c.graph_finalized == 0)
                                & (self.jobs.c.lease_until < now_ms()),
                            ),
                            self.jobs.c.available_at <= now_ms(),
                            self.jobs.c.kind.in_(
                                (
                                    ["REPLY", "APPLICATION"]
                                    if self.settings.automation_enabled
                                    else []
                                )
                                + (["CAREER_REVIEW"] if self.settings.career_enabled else [])
                            ),
                        )
                        .order_by(self.jobs.c.available_at, self.jobs.c.created_at)
                        .limit(50)
                    )
                )
                .mappings()
                .all()
            )
            for row in candidates:
                job = dict(row)
                if await self.db.control(self.uid, "career:deleted:" + job["id"], None, c):
                    continue
                if job["compute_started"] and not job["artifact_id"]:
                    await self.update_job(
                        c,
                        job,
                        status="UNCERTAIN",
                        phase="UNCERTAIN",
                        last_error_code="MODEL_RESULT_UNCERTAIN",
                        lease_token=None,
                        lease_until=None,
                    )
                    continue
                actions = await self.action_rows(self.uid, job["id"], c)
                approvals = [
                    {
                        "actionId": a["id"],
                        "approvalId": a["approval_id"],
                        "decision": "APPROVE" if a["approval_status"] == "APPROVED" else "DECLINE",
                    }
                    for a in actions
                    if a["approval_id"]
                ]
                receipts = [
                    {"actionId": a["id"], "status": a["status"]}
                    for a in actions
                    if a["status"] in {"ACKNOWLEDGED", "FAILED", "UNKNOWN", "CANCELLED"}
                ]
                terminal = job["status"] in {"COMPLETED", "FAILED"}
                execution = (
                    "RECONCILE_TERMINAL"
                    if terminal
                    else "RESUME_CONFIRMATION"
                    if job["status"] == "CONFIRMATION_READY"
                    else "RESUME_EXECUTION"
                    if job["status"] == "EXECUTION_READY"
                    else "START"
                )
                await self.update_job(
                    c,
                    job,
                    status=job["status"] if terminal else "RUNNING",
                    phase="FINALIZING" if execution != "START" else "COLLECTING",
                    lease_token=token(),
                    lease_until=now_ms() + self.settings.automation_lease_seconds * 1000,
                    attempts=job["attempts"] + 1,
                )
                return {
                    "jobId": job["id"],
                    "kind": job["kind"],
                    "revision": job["revision"],
                    "inputHash": job["input_hash"],
                    "leaseToken": job["lease_token"],
                    "leaseUntil": job["lease_until"],
                    "executionMode": execution,
                    "phase": job["phase"],
                    "artifactId": job["artifact_id"],
                    "resultId": job["result_id"],
                    "resumeData": {"receipts": receipts, "approvals": approvals},
                    "context": {
                        "schemaVersion": 1,
                        "jobKind": job["kind"],
                        "requiresExecution": bool(actions) or job["kind"] != "CAREER_REVIEW",
                        "requiresConfirmation": any(
                            a["approval_status"] == "PENDING" for a in actions
                        )
                        or (
                            job["kind"] == "CAREER_REVIEW"
                            and await self.wait_for(self.uid, job["id"], c) == "CONFIRMATION"
                        ),
                    },
                }
            return None

    async def renew(self, job_id, payload):
        async with self.transaction(self.uid) as c:
            job = await self.checked(c, job_id, payload, terminal=True)
            await self.update_job(
                c, job, lease_until=now_ms() + self.settings.automation_lease_seconds * 1000
            )
            return {"jobId": job_id, "leaseUntil": job["lease_until"]}

    async def gather(self, job_id, payload):
        async with self.transaction(self.uid) as c:
            job = await self.checked(c, job_id, payload)
            await self.update_job(c, job, phase="COLLECTING")
            return {
                "jobId": job_id,
                "inputHash": job["input_hash"],
                "ready": not loads(job["context_json"], {}).get("missingMaterials"),
                "artifactId": job["artifact_id"],
            }

    async def compute(self, job_id, payload):
        async with self.db.lock(self.uid, "automation:compute:" + job_id):
            async with self.transaction(self.uid) as c:
                job = await self.checked(c, job_id, payload)
                if job["artifact_id"]:
                    return {"jobId": job_id, "artifactId": job["artifact_id"], "reused": True}
                if job["compute_started"]:
                    raise ApiError("ANALYSIS_BUSY", 409)
                changed = job["kind"] != "CAREER_REVIEW" and loads(job["context_json"], {})[
                    "scopeHash"
                ] != await self.scope(self.uid, c)
                await self.update_job(c, job, compute_started=1, phase="ANALYZING")
            try:
                artifact = self.stopped_artifact(job) if changed else await compute(self, job)
            except ApiError:
                async with self.transaction(self.uid) as c:
                    current = await self.checked(c, job_id, payload)
                    await self.update_job(
                        c, current, compute_started=0, last_error_code="MODEL_UNAVAILABLE"
                    )
                raise ApiError("MODEL_UNAVAILABLE", 503) from None
            async with self.transaction(self.uid) as c:
                current = await self.checked(c, job_id, payload)
                if current["input_hash"] != job["input_hash"]:
                    raise ApiError("INPUT_CHANGED", 409)
                if job["kind"] != "CAREER_REVIEW" and loads(job["context_json"], {})[
                    "scopeHash"
                ] != await self.scope(self.uid, c):
                    artifact = self.stopped_artifact(job)
                await self.update_job(
                    c,
                    current,
                    artifact_id=identifier(),
                    artifact_json=dumps(artifact),
                    compute_started=0,
                )
                return {"jobId": job_id, "artifactId": current["artifact_id"], "reused": False}

    def stopped_artifact(self, job):
        return {
            "inputHash": job["input_hash"],
            "actions": [],
            "highInterest": False,
            "result": {
                "schemaVersion": 1,
                "kind": job["kind"],
                "decision": {"code": "STOP", "reason": "授权或资料已改变，本轮草稿已撤销"},
                "analysis": None,
                "missingMaterials": [],
            },
        }

    def artifact(self, job, payload):
        if not job["artifact_id"] or job["artifact_id"] != payload.artifactId:
            raise ApiError("ARTIFACT_NOT_FOUND", 409)
        return loads(job["artifact_json"], {})

    async def validate(self, job_id, payload):
        async with self.transaction(self.uid) as c:
            job = await self.checked(c, job_id, payload)
            artifact = self.artifact(job, payload)
            valid = validate_artifact(job, artifact)
            await self.update_job(
                c,
                job,
                phase="VALIDATING",
                validation_hash=digest(artifact) if valid else None,
                last_error_code=None if valid else "VALIDATION_FAILED",
            )
            return {
                "jobId": job_id,
                "artifactId": payload.artifactId,
                "valid": valid,
                "errorCode": None if valid else "VALIDATION_FAILED",
            }

    async def commit(self, job_id, payload):
        async with self.transaction(self.uid) as c:
            job = await self.checked(c, job_id, payload)
            artifact = self.artifact(job, payload)
            if (
                not job["validation_hash"]
                or job["validation_hash"] != digest(artifact)
                or not validate_artifact(job, artifact)
            ):
                raise ApiError("VALIDATION_FAILED", 409)
            if job["result_id"] is None:
                if job["kind"] == "CAREER_REVIEW":
                    from ..career.reviews import Reviews

                    await Reviews(self.db, self.settings).persist_review(c, job, artifact)
                for sequence, proposed in enumerate(artifact["actions"], start=1):
                    await c.execute(
                        self.actions.insert().values(
                            id=identifier(),
                            user_id=self.uid,
                            job_id=job_id,
                            kind=proposed["kind"],
                            sequence=sequence,
                            status="QUEUED",
                            payload_json=dumps(proposed["payload"]),
                            payload_hash=proposed["payloadHash"],
                            approval_status=proposed["approvalStatus"],
                            finalized=0,
                            created_at=now_ms(),
                            updated_at=now_ms(),
                        )
                    )
                await self.update_job(
                    c, job, result_id=job["artifact_id"], result_json=dumps(artifact["result"])
                )
            await self.update_job(c, job, phase="SAVED")
            return {
                "jobId": job_id,
                "artifactId": payload.artifactId,
                "status": "RUNNING",
                "waitFor": await self.wait_for(self.uid, job_id, c),
                "resultId": job["result_id"],
            }

    async def park(self, job_id, payload):
        async with self.transaction(self.uid) as c:
            job = await self.checked(c, job_id, payload)
            self.artifact(job, payload)
            if not job["result_id"] or payload.waitFor == "NONE":
                raise ApiError("INVALID_PARK", 409)
            await self.expire_actions(c, self.uid, job)
            wait = await self.wait_for(self.uid, job_id, c)
            if payload.waitFor == "CONFIRMATION":
                status = "WAITING_CONFIRMATION" if wait == "CONFIRMATION" else "CONFIRMATION_READY"
            else:
                status = "WAITING_EXECUTION" if wait == "EXECUTION" else "EXECUTION_READY"
            if any(a["status"] == "UNKNOWN" for a in await self.action_rows(self.uid, job_id, c)):
                status = "UNCERTAIN"
            await self.update_job(
                c,
                job,
                status=status,
                phase=status,
                lease_token=None,
                lease_until=None,
                available_at=now_ms(),
            )
            return {"jobId": job_id, "status": status}

    async def complete(self, job_id, payload):
        async with self.transaction(self.uid) as c:
            existing = await self.row(self.jobs, self.uid, job_id, c)
            if await self.db.control(self.uid, "career:deleted:" + job_id, None, c):
                raise ApiError("JOB_DELETED", 409)
            if existing["status"] in {"COMPLETED", "FAILED"} and existing["result_id"]:
                self.artifact(existing, payload)
                if (
                    payload.revision != existing["revision"]
                    or payload.inputHash != existing["input_hash"]
                ):
                    raise ApiError("INPUT_CHANGED", 409)
                return {
                    "jobId": job_id,
                    "status": existing["status"],
                    "resultId": existing["result_id"],
                    "waitFor": "NONE",
                }
            job = await self.checked(c, job_id, payload)
            self.artifact(job, payload)
            if not job["result_id"]:
                raise ApiError("RESULT_NOT_SAVED", 409)
            await self.expire_actions(c, self.uid, job)
            actions = await self.action_rows(self.uid, job_id, c)
            wait = await self.wait_for(self.uid, job_id, c)
            if any(a["status"] == "UNKNOWN" for a in actions):
                status, wait = "UNCERTAIN", "NONE"
            elif any(a["status"] == "FAILED" for a in actions):
                status, wait = "FAILED", "NONE"
            else:
                status = "COMPLETED" if wait == "NONE" else "RUNNING"
            values = {"status": status, "phase": "FINALIZING" if status == "RUNNING" else status}
            if status in {"COMPLETED", "FAILED"}:
                values["graph_finalized"] = 0
            elif status != "RUNNING":
                values.update(lease_token=None, lease_until=None)
            if status == "FAILED":
                values["last_error_code"] = next(
                    (
                        a["last_error_code"]
                        for a in actions
                        if a["status"] == "FAILED" and a["last_error_code"]
                    ),
                    "PLATFORM_REJECTED",
                )
            await self.update_job(c, job, **values)
            if status == "COMPLETED":
                worker = await self.db.control(self.uid, "automation:worker", {}, c)
                worker["lastCompletedAt"] = now_ms()
                await self.db.set_control(c, self.uid, "automation:worker", worker)
            return {
                "jobId": job_id,
                "status": status,
                "resultId": job["result_id"],
                "waitFor": wait,
            }

    async def graph_complete(self, job_id, payload):
        async with self.transaction(self.uid) as c:
            job = await self.row(self.jobs, self.uid, job_id, c)
            if await self.db.control(self.uid, "career:deleted:" + job_id, None, c):
                raise ApiError("JOB_DELETED", 409)
            self.artifact(job, payload)
            if (
                job["status"] not in {"COMPLETED", "FAILED"}
                or payload.revision != job["revision"]
                or payload.inputHash != job["input_hash"]
            ):
                raise ApiError("INPUT_CHANGED", 409)
            if not job["graph_finalized"]:
                await self.checked(c, job_id, payload, terminal=True)
                await self.update_job(
                    c,
                    job,
                    graph_finalized=1,
                    lease_token=None,
                    lease_until=None,
                    phase=job["status"],
                )
            return {"jobId": job_id, "status": job["status"], "graphFinalized": True}

    async def retry(self, job_id, payload):
        async with self.transaction(self.uid) as c:
            job = await self.checked(c, job_id, payload)
            status = (
                "FAILED"
                if job["attempts"] >= 3
                or payload.errorCode in {"VALIDATION_FAILED", "CHECKPOINT_UNAVAILABLE"}
                else "RETRY"
            )
            if job["compute_started"]:
                status = "UNCERTAIN"
            next_time = (
                now_ms() + min(60000, 1000 * 2 ** job["attempts"]) if status == "RETRY" else None
            )
            await self.update_job(
                c,
                job,
                status=status,
                phase=status,
                available_at=next_time or now_ms(),
                last_error_code=payload.errorCode,
                lease_token=None,
                lease_until=None,
            )
            return {"jobId": job_id, "status": status, "nextAttemptAt": next_time}
