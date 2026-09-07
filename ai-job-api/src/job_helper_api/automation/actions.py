import hmac

from sqlalchemy import select

from ..conversation import is_stopped
from ..database import dumps, loads, now_ms
from ..employment_exclusions import conversation_exclusion
from ..errors import ApiError
from .finalization import acknowledge_text, notify_ack
from .storage import TERMINAL, Storage, digest, token


def same(left, right):
    return bool(left and right) and hmac.compare_digest(str(left).encode(), str(right).encode())


class Actions(Storage):
    async def heartbeat(self, uid, payload):
        async with self.transaction(uid) as c:
            await self.account(uid, payload.platformAccount, c)
            key = "automation:executor:" + digest(payload.executorId)
            previous = await self.db.control(uid, key, {}, c)
            scope = await self.scope(uid, c)
            raw = payload.model_dump()
            changed = previous.get("scopeHash") != scope or previous.get("input") != raw
            revision = max(1, previous.get("authorizationRevision", 0) + int(changed))
            value = {
                "input": raw,
                "scopeHash": scope,
                "authorizationRevision": revision,
                "lastSeenAt": now_ms(),
            }
            await self.db.set_control(c, uid, key, value)
            await self.db.set_control(
                c, uid, "automation:executor-latest", {"lastSeenAt": value["lastSeenAt"]}
            )
            return {
                "executorId": payload.executorId,
                "authorizationRevision": revision,
                "leaseUntil": value["lastSeenAt"] + 60000,
            }

    async def authority(self, uid, job, payload, c):
        await self.account(uid, payload.platformAccount, c)
        if job["platform_account"] != payload.platformAccount or job["status"] in TERMINAL:
            raise ApiError("ACTION_NOT_READY", 409)
        executor = await self.db.control(
            uid, "automation:executor:" + digest(payload.executorId), {}, c
        )
        if executor.get("lastSeenAt", 0) + 60000 < now_ms() or executor.get(
            "scopeHash"
        ) != await self.scope(uid, c):
            raise ApiError("AUTHORIZATION_CHANGED", 409)
        raw = executor.get("input", {})
        if raw.get("platformAccount") != payload.platformAccount:
            raise ApiError("AUTHORIZATION_CHANGED", 409)
        if executor["scopeHash"] != loads(job["context_json"], {}).get("scopeHash"):
            raise ApiError("AUTHORIZATION_CHANGED", 409)
        if not raw.get("replyEnabled" if job["kind"] == "REPLY" else "deliveryEnabled"):
            raise ApiError("AUTOMATION_PAUSED", 409)
        input_ = loads(job["input_json"], {}).get("input", {})
        if job["kind"] == "REPLY" and await is_stopped(self.db, uid, input_["jobKey"]):
            raise ApiError("AUTOMATION_PAUSED", 409)
        if await self.db.control(uid, "stop:*", False, c):
            raise ApiError("AUTOMATION_PAUSED", 409)
        return executor

    async def prerequisites(self, uid, job, action, c):
        if action["approval_status"] not in {"NOT_REQUIRED", "APPROVED"}:
            return False
        payload = loads(action["payload_json"], {})
        if action["kind"] != "CONTACT_JOB" and (
            not payload.get("bossId") or not payload.get("conversationKey")
        ):
            return False
        if action["kind"] in {"SEND_RESUME", "ACCEPT_RESUME"} and not payload.get(
            "platformResumeId"
        ):
            return False
        preceding = [
            a
            for a in await self.action_rows(uid, job["id"], c)
            if a["sequence"] < action["sequence"]
        ]
        return all(
            a["status"] == "ACKNOWLEDGED" or a["approval_status"] == "DECLINED" for a in preceding
        )

    async def claim(self, uid, payload):
        async with self.transaction(uid) as c:
            job = await self.row(self.jobs, uid, payload.jobId, c)
            executor = await self.authority(uid, job, payload, c)
            await self.expire_actions(c, uid, job)
            if await self.wait_for(uid, job["id"], c) == "CONFIRMATION":
                return None
            for action in await self.action_rows(uid, job["id"], c):
                if (
                    action["status"] != "QUEUED"
                    or action["kind"] not in executor["input"]["capabilities"]
                ):
                    continue
                if not await self.prerequisites(uid, job, action, c):
                    continue
                await self.update_action(
                    c,
                    action,
                    status="LEASED",
                    executor_id=payload.executorId,
                    lease_token=token(),
                    lease_until=now_ms() + self.settings.action_lease_seconds * 1000,
                    authorization_revision=executor["authorizationRevision"],
                )
                return {
                    **self.action_view(action),
                    "leaseToken": action["lease_token"],
                    "leaseUntil": action["lease_until"],
                    "authorizationRevision": action["authorization_revision"],
                }
            await self.wake(c, job)
            return None

    async def dispatch(self, uid, action_id, payload):
        # Exclusions may persist remembered evidence; run outside the state transaction.
        before = await self.row(self.actions, uid, action_id)
        job_before = await self.row(self.jobs, uid, before["job_id"])
        input_ = loads(job_before["input_json"], {}).get("input", {})
        if job_before["kind"] == "REPLY" and await conversation_exclusion(
            self.db, uid, input_["jobKey"], input_["question"], input_.get("jobInfo")
        ):
            raise ApiError("EMPLOYMENT_EXCLUDED", 409)
        async with self.transaction(uid) as c:
            action = await self.row(self.actions, uid, action_id, c)
            job = await self.row(self.jobs, uid, action["job_id"], c)
            executor = await self.authority(uid, job, payload, c)
            if action["kind"] not in executor["input"]["capabilities"]:
                raise ApiError("AUTHORIZATION_CHANGED", 409)
            if action["kind"] in {"SEND_TEXT", "SEND_GREETING"}:
                if (
                    not payload.clientMid
                    or not payload.clientMid.isascii()
                    or not payload.clientMid.isdigit()
                    or int(payload.clientMid) <= 0
                ):
                    raise ApiError("EXACT_CLIENT_MID_REQUIRED", 422)
                collision = await self.db.one(
                    select(self.actions.c.id).where(
                        self.actions.c.user_id == uid,
                        self.actions.c.client_mid == payload.clientMid,
                        self.actions.c.id != action_id,
                    ),
                    c,
                )
                if collision:
                    raise ApiError("CLIENT_MID_ALREADY_BOUND", 409)
            elif payload.clientMid is not None:
                raise ApiError("NON_MESSAGE_MID_NOT_ALLOWED", 422)
            if (
                action["status"] != "LEASED"
                or action["executor_id"] != payload.executorId
                or not same(action["lease_token"], payload.leaseToken)
                or (action["lease_until"] or 0) < now_ms()
                or action["authorization_revision"] != payload.authorizationRevision
                or executor["authorizationRevision"] != payload.authorizationRevision
                or not await self.prerequisites(uid, job, action, c)
            ):
                raise ApiError("ACTION_NOT_READY", 409)
            await self.update_action(
                c,
                action,
                status="DISPATCHING",
                client_mid=payload.clientMid,
                dispatch_token=token(),
            )
            if action["kind"] == "CONTACT_JOB" and self.settings.career_enabled:
                from ..career.strategies import Strategies

                await Strategies(self.db, self.settings).reserve_contact(c, uid, job, action)
            return {
                "actionId": action_id,
                "status": "DISPATCHING",
                "dispatchToken": action["dispatch_token"],
                "clientMid": action["client_mid"],
            }

    async def apply_binding(self, c, uid, job, binding):
        if (job["boss_id"] and job["boss_id"] != binding.bossId) or (
            job["conversation_key"] and job["conversation_key"] != binding.conversationKey
        ):
            raise ApiError("BINDING_CONFLICT", 409)
        await self.update_job(
            c, job, boss_id=binding.bossId, conversation_key=binding.conversationKey
        )
        from ..career.observations import record_binding

        await record_binding(self, c, uid, job)
        for pending in await self.action_rows(uid, job["id"], c):
            if pending["kind"] == "SEND_GREETING" and pending["status"] == "QUEUED":
                raw = loads(pending["payload_json"], {})
                raw.update(bossId=binding.bossId, conversationKey=binding.conversationKey)
                await self.update_action(
                    c, pending, payload_json=dumps(raw), payload_hash=digest(raw)
                )

    async def binding(self, uid, action_id, payload):
        async with self.transaction(uid) as c:
            action = await self.row(self.actions, uid, action_id, c)
            job = await self.row(self.jobs, uid, action["job_id"], c)
            await self.account(uid, payload.platformAccount, c)
            if (
                action["kind"] != "CONTACT_JOB"
                or action["status"] != "ACKNOWLEDGED"
                or job["platform_account"] != payload.platformAccount
            ):
                raise ApiError("ACTION_NOT_READY", 409)
            _, repeated = await self.event(
                c, uid, payload.requestId, "BINDING", payload.model_dump(), job["id"], action_id
            )
            if not repeated:
                await self.apply_binding(c, uid, job, payload)
            return await self.view(uid, job, c)

    async def receipt(self, uid, action_id, payload):
        notify = False
        async with self.transaction(uid) as c:
            action = await self.row(self.actions, uid, action_id, c)
            job = await self.row(self.jobs, uid, action["job_id"], c)
            await self.account(uid, payload.platformAccount, c)
            if (
                job["platform_account"] != payload.platformAccount
                or action["executor_id"] != payload.executorId
                or not same(action["dispatch_token"], payload.dispatchToken)
                or action["client_mid"] != payload.clientMid
            ):
                raise ApiError("RECEIPT_BINDING_CONFLICT", 409)
            if payload.occurredAt > now_ms() + 60000:
                raise ApiError("INVALID_EVENT_TIME", 422)
            if payload.resolvedBinding and (
                action["kind"] != "CONTACT_JOB" or payload.status != "ACKNOWLEDGED"
            ):
                raise ApiError("INVALID_BINDING", 422)
            if payload.status == "ACKNOWLEDGED":
                if action["kind"] in {"SEND_TEXT", "SEND_GREETING"}:
                    if (
                        not payload.serverMid
                        or not payload.serverMid.isascii()
                        or not payload.serverMid.isdigit()
                        or int(payload.serverMid) <= 0
                        or payload.serverMid == payload.clientMid
                    ):
                        raise ApiError("EXACT_MESSAGE_ACK_REQUIRED", 422)
                    collision = await self.db.one(
                        select(self.actions.c.id).where(
                            self.actions.c.user_id == uid,
                            self.actions.c.server_mid == payload.serverMid,
                            self.actions.c.id != action_id,
                        ),
                        c,
                    )
                    if collision:
                        raise ApiError("SERVER_MID_ALREADY_BOUND", 409)
                elif payload.platformCode != 0:
                    raise ApiError("PLATFORM_SUCCESS_REQUIRED", 422)
            preflight = payload.executionPhase == "BEFORE_PLATFORM_CALL"
            if preflight and not (
                payload.status == "FAILED"
                and payload.platformCode is None
                and payload.serverMid is None
                and payload.resolvedBinding is None
                and payload.errorCode in {"AUTHORIZATION_CHANGED", "CONTEXT_LOST"}
            ):
                raise ApiError("INVALID_PREFLIGHT_ABORT", 422)
            if (
                not preflight
                and payload.status == "FAILED"
                and (payload.platformCode is None or payload.platformCode == 0)
            ):
                raise ApiError("DEFINITE_PLATFORM_FAILURE_REQUIRED", 422)
            raw = payload.model_dump()
            raw.pop("dispatchToken")
            _, repeated = await self.event(
                c, uid, payload.requestId, "RECEIPT", raw, job["id"], action_id
            )
            if not repeated:
                if action["status"] == "ACKNOWLEDGED":
                    if (
                        payload.status != "ACKNOWLEDGED"
                        or action["server_mid"] != payload.serverMid
                    ):
                        raise ApiError("RECEIPT_CONFLICT", 409)
                elif action["status"] not in {"DISPATCHING", "UNKNOWN"}:
                    raise ApiError("RECEIPT_CONFLICT", 409)
                else:
                    # A definite failure is terminal. Only uncertainty can be resolved by a late ACK.
                    await self.update_action(
                        c,
                        action,
                        status=payload.status,
                        server_mid=payload.serverMid,
                        last_error_code=payload.errorCode
                        if payload.status != "ACKNOWLEDGED"
                        else None,
                    )
                if payload.resolvedBinding:
                    await self.apply_binding(c, uid, job, payload.resolvedBinding)
                if action["status"] == "FAILED":
                    for pending in await self.action_rows(uid, job["id"], c):
                        if pending["sequence"] > action["sequence"] and pending["status"] in {
                            "QUEUED",
                            "LEASED",
                        }:
                            await self.update_action(
                                c,
                                pending,
                                status="CANCELLED",
                                last_error_code="PREREQUISITE_FAILED",
                            )
                notify = await acknowledge_text(self, c, uid, job, action)
                from ..career.observations import record_ack

                await record_ack(self, c, uid, job, action, payload.occurredAt)
            await self.wake(c, job)
            result = self.action_view(action)
        if notify:
            await notify_ack(self, uid, job, action)
        return result

    async def approval(self, uid, action_id, payload):
        async with self.transaction(uid) as c:
            action = await self.row(self.actions, uid, action_id, c)
            job = await self.row(self.jobs, uid, action["job_id"], c)
            if action["payload_hash"] != payload.payloadHash:
                raise ApiError("APPROVAL_STALE", 409)
            event, repeated = await self.event(
                c, uid, payload.requestId, "APPROVAL", payload.model_dump(), job["id"], action_id
            )
            if not repeated:
                expected = "APPROVED" if payload.decision == "APPROVE" else "DECLINED"
                if (
                    action["approval_status"] not in {"PENDING", expected}
                    or job["status"] in TERMINAL
                ):
                    raise ApiError("APPROVAL_STALE", 409)
                await self.update_action(
                    c,
                    action,
                    approval_status=expected,
                    approval_id=event["id"],
                    status="CANCELLED" if expected == "DECLINED" else action["status"],
                )
            await self.wake(c, job)
            return self.action_view(action)
