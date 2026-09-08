import asyncio
import secrets

from sqlalchemy import or_, select

from ..config import Settings
from ..database import Database, dumps, loads, now_ms
from ..errors import ApiError
from ..model import ModelClient
from ..rejection_engine.service import compute_report, digest, snapshot_row
from .contracts import Analyze, Artifact, Claim, Complete, Lease, Park, Retry
from .policy import analysis_messages, project
from .storage import OutcomeStorage, ident, phase_values
from .validation import published_report, valid_report


class OutcomeWorkflow(OutcomeStorage):
    def __init__(self, db: Database, settings: Settings, model: ModelClient) -> None:
        super().__init__(db, settings)
        self.model = model

    async def checked(self, job_id, payload, connection, *, allow_completed=False):
        uid = self.settings.owner_user_id
        job = await self.row("outcome_job", uid, job_id, connection)
        if not job:
            raise ApiError("JOB_NOT_FOUND", 404)
        if payload.revision != job["revision"] or payload.inputHash != job["input_hash"]:
            raise ApiError("INPUT_MISMATCH", 409)
        case = await self.row("outcome_case", uid, job["case_id"], connection)
        if case["revision"] != job["revision"] or job["status"] == "SUPERSEDED":
            raise ApiError("REVISION_SUPERSEDED", 409)
        if allow_completed and job["status"] == "COMPLETED":
            return job, case
        if (
            job["status"] != "RUNNING"
            or not job["lease_token"]
            or not secrets.compare_digest(job["lease_token"], payload.leaseToken)
            or (job["lease_until"] or 0) <= now_ms()
        ):
            raise ApiError("LEASE_LOST", 409)
        return job, case

    async def claim(self, payload: Claim) -> dict | None:
        uid, now = self.settings.owner_user_id, now_ms()
        cases, jobs = self.db.table("outcome_case"), self.db.table("outcome_job")
        async with self.transaction(uid) as connection:
            due = (
                (
                    await connection.execute(
                        select(cases)
                        .where(cases.c.user_id == uid, cases.c.next_check_at <= now)
                        .limit(20)
                    )
                )
                .mappings()
                .all()
            )
            for case in due:
                facts = loads(case["facts_json"], {})
                projection = project(facts, self.settings, now)
                facts["projection"] = projection
                await self.queue(case, facts, projection, connection, now)
            condition = or_(
                jobs.c.status.in_(["READY", "RETRY", "CONFIRMATION_READY", "WAITING_CONFIRMATION"]),
                (jobs.c.status == "RUNNING") & (jobs.c.lease_until <= now),
            )
            candidates = (
                (
                    await connection.execute(
                        select(jobs)
                        .where(jobs.c.user_id == uid, condition, jobs.c.available_at <= now)
                        .order_by(jobs.c.available_at, jobs.c.id)
                        .limit(20)
                    )
                )
                .mappings()
                .all()
            )
            for job in candidates:
                claimed_status = job["status"]
                case = await self.row("outcome_case", uid, job["case_id"], connection)
                if case["revision"] != job["revision"]:
                    await self.update(
                        "outcome_job",
                        job,
                        dict(
                            status="SUPERSEDED", lease_token=None, lease_until=None, updated_at=now
                        ),
                        connection,
                    )
                    continue
                context = loads(job["context_json"])
                if context is None:
                    facts = loads(case["facts_json"], {})
                    projection = project(facts, self.settings, now)
                    snapshot = await snapshot_row(self.db, uid, case["encrypt_job_id"], connection)
                    context = {
                        "projection": projection,
                        "facts": facts,
                        "snapshot": dict(snapshot) if snapshot else None,
                    }
                input_hash = job["input_hash"] or digest(context)
                values = dict(
                    status="RUNNING",
                    lease_token=secrets.token_urlsafe(36),
                    lease_until=now + self.settings.outcome_lease_seconds * 1000,
                    attempts=job["attempts"] + 1,
                    context_json=dumps(context),
                    input_hash=input_hash,
                    updated_at=now,
                )
                if not job["report_id"]:
                    values.update(phase_values(job, "COLLECTING", now))
                job = await self.update("outcome_job", job, values, connection)
                await self.update(
                    "outcome_case", case, {"status": "PROCESSING", "updated_at": now}, connection
                )
                feedback = (
                    await self.row("outcome_feedback", uid, job["feedback_id"], connection)
                    if job["feedback_id"]
                    else None
                )
                public_context = {
                    k: context["projection"][k]
                    for k in (
                        "outcome",
                        "readState",
                        "waitingOn",
                        "processingStatus",
                        "asOf",
                        "analysisKind",
                        "policyVersion",
                        "graphVersion",
                    )
                }
                # Reports created by graph v1 used human feedback as a mandatory
                # workflow gate. Reclaim them through v2 when no feedback exists.
                if claimed_status == "WAITING_CONFIRMATION" and not feedback:
                    public_context["graphVersion"] = "outcome-graph-v2"
                public_context.update(
                    schemaVersion=1,
                    caseId=case["id"],
                    revision=job["revision"],
                    inputHash=input_hash,
                )
                return dict(
                    jobId=job["id"],
                    caseId=case["id"],
                    revision=job["revision"],
                    inputHash=input_hash,
                    leaseToken=job["lease_token"],
                    leaseUntil=job["lease_until"],
                    executionMode="RESUME_CONFIRMATION" if feedback else "START",
                    phase=job["phase"],
                    humanFeedback={
                        "feedbackId": feedback["id"],
                        "reportId": feedback["report_id"],
                        "action": feedback["action"],
                    }
                    if feedback
                    else None,
                    reportId=job["report_id"],
                    artifactId=job["artifact_id"],
                    context=public_context,
                )
        return None

    async def renew(self, job_id: str, payload: Lease) -> dict:
        async with self.transaction(self.settings.owner_user_id) as connection:
            job, _ = await self.checked(job_id, payload, connection)
            until = now_ms() + self.settings.outcome_lease_seconds * 1000
            await self.update("outcome_job", job, {"lease_until": until}, connection)
            return dict(jobId=job_id, revision=job["revision"], leaseUntil=until)

    async def analyze(self, job_id: str, payload: Analyze) -> dict:
        uid = self.settings.owner_user_id
        try:
            async with self.db.lock(uid, "outcome-analysis:" + job_id):
                async with self.transaction(uid) as connection:
                    job, _ = await self.checked(job_id, payload, connection)
                    context = loads(job["context_json"])
                    projection = context["projection"]
                    if payload.analysisKind != projection["analysisKind"]:
                        raise ApiError("INPUT_MISMATCH", 409)
                    if job["artifact_id"]:
                        return self.artifact_response(job, reused=True)
                    await self.update(
                        "outcome_job", job, phase_values(job, "ANALYZING", now_ms()), connection
                    )
                report = {
                    k: projection[k]
                    for k in ("outcome", "readState", "waitingOn", "asOf", "summary", "evidence")
                }
                report.update(
                    analysisSource="RULES_ONLY",
                    explicitReasons=[],
                    inferredRisks=[],
                    unknowns=[],
                    suggestions=[],
                )
                if payload.analysisKind == "REJECTION_CAUSES":
                    messages = [
                        {"role": m["role"], "text": m["text"]} for m in analysis_messages(context)
                    ]
                    reasons, source, _ = await compute_report(
                        self.db, self.model, self.settings, uid, messages, context["snapshot"]
                    )
                    report.update(reasons)
                    report["analysisSource"] = source
                elif projection["processingStatus"] == "WAITING_OBSERVATION":
                    report["unknowns"].append("缺少到期后的可信会话观察，尚不能确认无回复。")
                artifact = {
                    "inputHash": payload.inputHash,
                    "report": report,
                    "contentHash": digest(report),
                }
                async with self.transaction(uid) as connection:
                    job, _ = await self.checked(job_id, payload, connection)
                    if not job["artifact_id"]:
                        job = await self.update(
                            "outcome_job",
                            job,
                            dict(
                                artifact_id=ident(),
                                artifact_json=dumps(artifact),
                                updated_at=now_ms(),
                            ),
                            connection,
                        )
                    return self.artifact_response(job, reused=False)
        except ApiError as error:
            if error.code == 409 and error.message == "该操作正在处理中，请稍后查看结果":
                raise ApiError("ANALYSIS_BUSY", 409) from None
            raise
        except asyncio.CancelledError:
            raise

    @staticmethod
    def artifact_response(job, *, reused):
        return dict(
            jobId=job["id"],
            revision=job["revision"],
            inputHash=job["input_hash"],
            artifactId=job["artifact_id"],
            reused=reused,
        )

    async def validate(self, job_id: str, payload: Artifact) -> dict:
        async with self.transaction(self.settings.owner_user_id) as connection:
            job, case = await self.checked(job_id, payload, connection)
            if not job["artifact_id"] or payload.artifactId != job["artifact_id"]:
                raise ApiError("ARTIFACT_MISMATCH", 409)
            artifact, context = loads(job["artifact_json"], {}), loads(job["context_json"], {})
            report, projection = artifact.get("report", {}), context.get("projection", {})
            valid = (
                artifact.get("contentHash") == digest(report)
                and artifact.get("inputHash") == job["input_hash"]
            )
            valid &= all(
                report.get(k) == projection.get(k)
                for k in ("outcome", "readState", "waitingOn", "asOf", "summary")
            )
            valid &= valid_report(report, context)
            values = phase_values(job, "VALIDATING" if valid else "FAILED", now_ms())
            if valid:
                values["validation_hash"] = digest(artifact)
                if job["report_id"]:
                    values = {"validation_hash": digest(artifact)}
            else:
                values.update(
                    status="FAILED",
                    last_error_code="INVALID_ARTIFACT",
                    lease_token=None,
                    lease_until=None,
                )
                await self.update(
                    "outcome_case", case, {"status": "FAILED", "updated_at": now_ms()}, connection
                )
            await self.update("outcome_job", job, values, connection)
            result = dict(
                jobId=job_id,
                artifactId=payload.artifactId,
                valid=bool(valid),
                validationVersion="outcome-validation-v1",
            )
            if not valid:
                result.pop("validationVersion")
                result.update(status="FAILED", errorCode="INVALID_ARTIFACT")
            return result

    @staticmethod
    def commit_response(job, case):
        return dict(
            jobId=job["id"],
            caseId=case["id"],
            caseRevision=job["revision"],
            reportId=job["report_id"],
            status=job["status"],
            phase=job["phase"],
            isCurrent=case["revision"] == job["revision"],
        )

    async def commit(self, job_id: str, payload: Artifact) -> dict:
        uid, now = self.settings.owner_user_id, now_ms()
        async with self.transaction(uid) as connection:
            job, case = await self.checked(job_id, payload, connection)
            if not job["artifact_id"] or payload.artifactId != job["artifact_id"]:
                raise ApiError("ARTIFACT_MISMATCH", 409)
            if job["report_id"]:
                job = await self.update(
                    "outcome_job", job, phase_values(job, "SAVED", now), connection
                )
                await self.update(
                    "outcome_case",
                    case,
                    {
                        "status": loads(job["context_json"])["projection"]["processingStatus"],
                        "updated_at": now,
                    },
                    connection,
                )
                return self.commit_response(job, case)
            artifact = loads(job["artifact_json"], {})
            if job["validation_hash"] != digest(artifact):
                raise ApiError("ARTIFACT_MISMATCH", 409)
            job = await self.update(
                "outcome_job", job, phase_values(job, "SAVING", now), connection
            )
            report_id = ident()
            await connection.execute(
                self.db.table("outcome_report")
                .insert()
                .values(
                    id=report_id,
                    user_id=uid,
                    case_id=case["id"],
                    revision=job["revision"],
                    report_json=dumps(
                        published_report(artifact["report"], loads(job["context_json"]))
                    ),
                    feedback_status="PENDING",
                    created_at=now,
                    updated_at=now,
                )
            )
            job = await self.update(
                "outcome_job",
                job,
                {**phase_values(job, "SAVED", now), "report_id": report_id},
                connection,
            )
            projection = loads(job["context_json"])["projection"]
            await self.update(
                "outcome_case",
                case,
                dict(
                    current_report_id=report_id,
                    status=projection["processingStatus"],
                    updated_at=now,
                ),
                connection,
            )
            return self.commit_response(job, case)

    async def park(self, job_id: str, payload: Park) -> dict:
        async with self.transaction(self.settings.owner_user_id) as connection:
            job, _ = await self.checked(job_id, payload, connection)
            if not job["report_id"] or job["artifact_id"] != payload.artifactId:
                raise ApiError("ARTIFACT_MISMATCH", 409)
            status = "CONFIRMATION_READY" if job["feedback_id"] else "WAITING_CONFIRMATION"
            values = {
                **phase_values(job, "WAITING_CONFIRMATION", now_ms()),
                "status": status,
                "lease_token": None,
                "lease_until": None,
                "available_at": now_ms(),
            }
            job = await self.update("outcome_job", job, values, connection)
            return dict(jobId=job_id, reportId=job["report_id"], status=status, phase=job["phase"])

    async def complete(self, job_id: str, payload: Complete) -> dict:
        async with self.transaction(self.settings.owner_user_id) as connection:
            job, case = await self.checked(job_id, payload, connection, allow_completed=True)
            if not job["report_id"] or job["artifact_id"] != payload.artifactId:
                raise ApiError("ARTIFACT_MISMATCH", 409)
            if payload.feedbackId is not None and job["feedback_id"] != payload.feedbackId:
                raise ApiError("ARTIFACT_MISMATCH", 409)
            if job["status"] != "COMPLETED":
                job = await self.update(
                    "outcome_job",
                    job,
                    {
                        **phase_values(job, "COMPLETED", now_ms()),
                        "status": "COMPLETED",
                        "lease_token": None,
                        "lease_until": None,
                    },
                    connection,
                )
                await self.update(
                    "outcome_case",
                    case,
                    {
                        "status": loads(job["context_json"])["projection"]["processingStatus"],
                        "updated_at": now_ms(),
                    },
                    connection,
                )
            report = await self.row(
                "outcome_report", self.settings.owner_user_id, job["report_id"], connection
            )
            if report and report["feedback_status"] == "PENDING":
                report = await self.update(
                    "outcome_report",
                    report,
                    {"feedback_status": "OPTIONAL", "updated_at": now_ms()},
                    connection,
                )
            if report:
                from ..career.observations import record_outcome_report

                await record_outcome_report(
                    self, connection, self.settings.owner_user_id, case, report
                )
            result = self.commit_response(job, case)
            result.pop("phase")
            return result

    async def retry(self, job_id: str, payload: Retry) -> dict:
        async with self.transaction(self.settings.owner_user_id) as connection:
            job, case = await self.checked(job_id, payload, connection)
            now = now_ms()
            status = "FAILED" if job["attempts"] >= 5 else "RETRY"
            available = now + min(300, 5 * 2 ** min(job["attempts"], 6)) * 1000
            await self.update(
                "outcome_job",
                job,
                {
                    **phase_values(job, status, now),
                    "status": status,
                    "available_at": available,
                    "lease_token": None,
                    "lease_until": None,
                    "last_error_code": payload.errorCode,
                },
                connection,
            )
            await self.update(
                "outcome_case", case, {"status": status, "updated_at": now}, connection
            )
            return dict(
                jobId=job_id, status=status, nextAttemptAt=available if status == "RETRY" else None
            )
