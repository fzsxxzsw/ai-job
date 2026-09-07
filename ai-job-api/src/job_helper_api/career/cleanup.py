"""Durable deletion fences. The Agent acknowledges actual checkpoint removal."""

from sqlalchemy import select

from ..automation.actions import same
from ..automation.storage import identifier, token
from ..database import loads, now_ms
from ..errors import ApiError
from .reviews import Reviews


class Cleanup(Reviews):
    async def delete_review(self, uid, job_id):
        async with self.transaction(uid) as c:
            job = await self.row(self.jobs, uid, job_id, c)
            if job["kind"] != "CAREER_REVIEW":
                raise ApiError("NOT_FOUND", 404)
            tombstone = await self.tombstone(uid, job_id, c)
            if not tombstone:
                tombstone = {
                    "jobId": job_id,
                    "cleanupId": identifier(),
                    "status": "DELETING",
                    "leaseToken": None,
                    "leaseUntil": None,
                }
                await self.db.set_control(c, uid, "career:deleted:" + job_id, tombstone)
                await self.update_job(
                    c,
                    job,
                    status="CANCELLED",
                    phase="CANCELLED",
                    input_json="{}",
                    context_json="{}",
                    artifact_json=None,
                    result_json=None,
                    validation_hash=None,
                    lease_token=None,
                    lease_until=None,
                    graph_finalized=1,
                    last_error_code="JOB_DELETED",
                )
                await c.execute(
                    self.proposals.delete().where(
                        self.proposals.c.user_id == uid, self.proposals.c.job_id == job_id
                    )
                )
                # Explicitly approved choices are separate user records; unapproved drafts are private review material.
                await c.execute(
                    self.strategies.delete().where(
                        self.strategies.c.user_id == uid,
                        self.strategies.c.job_id == job_id,
                        self.strategies.c.status == "DRAFT",
                    )
                )
                await self.db.set_control(c, uid, "career:confirmation:" + job_id, None)
            return {
                "jobId": job_id,
                "status": tombstone["status"],
                "checkpointDeleted": tombstone["status"] == "DELETED",
            }

    async def cleanup_claim(self, payload):
        async with self.transaction(self.uid) as c:
            controls = self.db.table("py_api_control")
            rows = (
                await c.execute(
                    select(controls).where(
                        controls.c.user_id == self.uid,
                        controls.c.control_key.like("career:deleted:%"),
                    )
                )
            ).mappings()
            for row in rows:
                value = loads(row["value_json"], {})
                if value["status"] == "DELETED" or (value.get("leaseUntil") or 0) > now_ms():
                    continue
                value.update(
                    leaseToken=token(),
                    leaseUntil=now_ms() + self.settings.automation_lease_seconds * 1000,
                )
                await self.db.set_control(c, self.uid, row["control_key"], value)
                return {k: value[k] for k in ("jobId", "cleanupId", "leaseToken", "leaseUntil")} | {
                    "kind": "CAREER_REVIEW"
                }
            return None

    async def cleanup_update(self, cleanup_id, payload, *, complete=False):
        async with self.transaction(self.uid) as c:
            value = await self.tombstone(self.uid, payload.jobId, c)
            if not value or value["cleanupId"] != cleanup_id:
                raise ApiError("NOT_FOUND", 404)
            if value["status"] == "DELETED" and complete:
                return {"jobId": payload.jobId, "cleanupId": cleanup_id, "status": "DELETED"}
            if (
                not same(value.get("leaseToken"), payload.leaseToken)
                or (value.get("leaseUntil") or 0) < now_ms()
            ):
                raise ApiError("LEASE_LOST", 409)
            if complete:
                value.update(status="DELETED", leaseToken=None, leaseUntil=None)
                result = {"jobId": payload.jobId, "cleanupId": cleanup_id, "status": "DELETED"}
            else:
                value["leaseUntil"] = now_ms() + self.settings.automation_lease_seconds * 1000
                result = {"cleanupId": cleanup_id, "leaseUntil": value["leaseUntil"]}
            await self.db.set_control(c, self.uid, "career:deleted:" + payload.jobId, value)
            return result
