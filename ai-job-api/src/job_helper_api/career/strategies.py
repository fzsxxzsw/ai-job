"""Approved future selections; applying a plan never starts platform automation."""

from ..automation.storage import digest
from ..database import loads, now_ms
from ..errors import ApiError
from ..execution_authority import bump_authority
from .proposals import Proposals


class Strategies(Proposals):
    def strategy_view(self, row):
        return {
            **self.json_value(row),
            "strategyId": row["id"],
            "status": row["status"],
            "previewHash": row["preview_hash"],
            "basePreferenceHash": row["base_preference_hash"],
            "createdAt": row["created_at"],
        }

    async def select_strategy(self, uid, ident, payload, *, apply=False):
        async with self.transaction(uid) as c:
            raw = {"strategyId": ident, "apply": apply, **payload.model_dump()}
            prior = await self.request(c, uid, payload.requestId, "SELECT_STRATEGY", raw)
            if prior:
                return self.strategy_view(await self.row(self.strategies, uid, ident, c))
            row = await self.row(self.strategies, uid, ident, c)
            if await self.tombstone(uid, row["job_id"], c) and row["status"] == "DRAFT":
                raise ApiError("JOB_DELETED", 409)
            if (
                row["preview_hash"] != payload.previewHash
                or row["base_preference_hash"] != payload.basePreferenceHash
                or digest(await self.preference(uid, c)) != payload.basePreferenceHash
            ):
                raise ApiError("STRATEGY_PREVIEW_CHANGED", 409)
            value = self.json_value(row)
            if value["missingInputs"] or not value["allocations"]:
                raise ApiError("STRATEGY_MISSING_INPUTS", 409)
            if apply and row["status"] not in {"APPROVED", "APPLIED"}:
                raise ApiError("STRATEGY_APPROVAL_REQUIRED", 409)
            changes = {"status": "APPLIED" if apply else "APPROVED"}
            if not apply and row["status"] == "APPLIED":
                changes["status"] = "APPLIED"
            changes["applied_at" if apply else "approved_at"] = (
                row["applied_at" if apply else "approved_at"] or now_ms()
            )
            await c.execute(
                self.strategies.update()
                .where(self.strategies.c.id == ident, self.strategies.c.user_id == uid)
                .values(**changes)
            )
            row.update(changes)
            if apply:
                await bump_authority(self.db, c, uid)
                await self.db.set_control(c, uid, "career:active-strategy", ident)
            await self.request(
                c, uid, payload.requestId, "SELECT_STRATEGY", raw, {"strategyId": ident}
            )
            return self.strategy_view(row)

    async def application_selection(self, uid, payload, bundle, c):
        selection = await self.selection(uid, c)
        if (
            payload.input.preparedResumeVersionId != selection["preparedResumeVersionId"]
            or payload.input.strategyPlanId != selection["strategyPlanId"]
        ):
            raise ApiError("CAREER_SELECTION_CHANGED", 409)
        version_id = selection["preparedResumeVersionId"]
        strategy_id = selection["strategyPlanId"]
        bundle["career"] = {**selection, "allocationGroup": None}
        if strategy_id:
            row = await self.row(self.strategies, uid, strategy_id, c)
            value = self.json_value(row)
            if row["status"] != "APPLIED" or row["base_preference_hash"] != digest(
                bundle["preference"]
            ):
                raise ApiError("STRATEGY_PREVIEW_CHANGED", 409)
            # Current rule-based plans have one explicit target group; no inferred job assignment.
            eligible = [
                a for a in value["allocations"] if a["category"] != "PAUSE" and a["count"] > 0
            ]
            if len(eligible) != 1:
                bundle["missingMaterials"].append(
                    "STRATEGY_BUDGET_EXHAUSTED"
                    if value["budget"] == 0
                    else "STRATEGY_GROUP_REQUIRES_CONFIRMATION"
                )
            else:
                allocation = eligible[0]
                version_id = allocation["resumeVersionId"]
                bundle["career"].update(
                    preparedResumeVersionId=version_id, allocationGroup=allocation["group"]
                )
                if not await self.budget_available(uid, strategy_id, allocation["group"], c):
                    bundle["missingMaterials"].append("STRATEGY_BUDGET_EXHAUSTED")
        if version_id:
            version = await self.row(self.versions, uid, version_id, c)
            bundle["resume"] = {
                "id": version_id,
                "resume_id": None,
                "resume_content": self.json_value(version)["content"],
            }
        return bundle

    async def budget_available(self, uid, strategy_id, group, c):
        row = await self.row(self.strategies, uid, strategy_id, c)
        value = self.json_value(row)
        allocation = next((a for a in value["allocations"] if a["group"] == group), None)
        if not allocation or allocation["category"] == "PAUSE":
            return False
        used = await self.db.control(uid, "career:budget:" + strategy_id, {}, c)
        return sum(used.values()) < value["budget"] and used.get(group, 0) < allocation["count"]

    async def reserve_contact(self, c, uid, job, action):
        bundle = loads(job["context_json"], {})
        career = bundle.get("career", {})
        plan, group = career.get("strategyPlanId"), career.get("allocationGroup")
        if not plan:
            return
        reservation = "career:reservation:" + action["id"]
        if await self.db.control(uid, reservation, False, c):
            return
        if not await self.budget_available(uid, plan, group, c):
            raise ApiError("STRATEGY_BUDGET_EXHAUSTED", 409)
        used = await self.db.control(uid, "career:budget:" + plan, {}, c)
        used[group] = used.get(group, 0) + 1
        await self.db.set_control(c, uid, "career:budget:" + plan, used)
        await self.db.set_control(c, uid, reservation, True)
        # A dispatch attempt consumes allocation even if its platform result is unknown.
