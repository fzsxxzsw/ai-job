import hashlib
import hmac
import secrets
from contextlib import asynccontextmanager
from uuid import uuid4

from sqlalchemy import select

from ..conversation import safe_history
from ..database import dumps, loads, now_ms
from ..errors import ApiError
from ..model import effective_config
from ..model_routing import quota_scope
from .history import current_rounds, history_key

TERMINAL = {"COMPLETED", "CANCELLED", "SUPERSEDED", "FAILED"}
SENSITIVE = {"SEND_RESUME", "ACCEPT_RESUME", "ACCEPT_PHONE", "ACCEPT_WECHAT"}
ACTION_DONE = {"ACKNOWLEDGED", "CANCELLED", "FAILED"}


def digest(value):
    return hashlib.sha256(dumps(value).encode()).hexdigest()


def identifier():
    return str(uuid4())


def token():
    return secrets.token_urlsafe(36)


class Storage:
    def __init__(self, db, settings, model=None, notifier=None):
        self.db, self.settings, self.model, self.notifier = db, settings, model, notifier
        self.uid = settings.owner_user_id
        self.jobs = db.table("automation_job")
        self.actions = db.table("automation_action")
        self.events = db.table("automation_action_event")

    @asynccontextmanager
    async def transaction(self, uid):
        if self.settings.read_only:
            raise ApiError("READ_ONLY", 503)
        if not await self.db.user(uid):
            raise ApiError("OWNER_INACTIVE", 403)
        async with self.db.lock(uid, "automation:state"):
            async with self.db.engine.begin() as c:
                users = self.db.table("user_info")
                active = await c.scalar(
                    select(users.c.id)
                    .where(users.c.id == uid, users.c.is_active.is_(True))
                    .with_for_update()
                )
                if active is None:
                    raise ApiError("OWNER_INACTIVE", 403)
                yield c

    async def row(self, table, uid, ident, c=None):
        row = await self.db.one(
            select(table).where(table.c.user_id == uid, self.db.exact(table.c.id, ident)), c
        )
        if not row:
            raise ApiError("NOT_FOUND", 404)
        return dict(row)

    async def action_rows(self, uid, job_id, c=None):
        stmt = (
            select(self.actions)
            .where(self.actions.c.user_id == uid, self.actions.c.job_id == job_id)
            .order_by(self.actions.c.sequence)
        )
        if c is not None:
            return [dict(r) for r in (await c.execute(stmt)).mappings()]
        return [dict(r) for r in await self.db.rows(stmt)]

    async def update_job(self, c, job, **values):
        values["updated_at"] = now_ms()
        if "phase" in values and values["phase"] != job["phase"]:
            history = loads(job["phase_history_json"], [])
            values["phase_history_json"] = dumps(
                (history + [{"phase": values["phase"], "at": values["updated_at"]}])[-100:]
            )
        await c.execute(
            self.jobs.update()
            .where(self.jobs.c.id == job["id"], self.jobs.c.user_id == job["user_id"])
            .values(**values)
        )
        job.update(values)

    async def update_action(self, c, action, **values):
        values["updated_at"] = now_ms()
        await c.execute(
            self.actions.update()
            .where(self.actions.c.id == action["id"], self.actions.c.user_id == action["user_id"])
            .values(**values)
        )
        action.update(values)

    async def event(self, c, uid, request_id, kind, payload, job_id=None, action_id=None):
        payload_hash = digest([kind, payload])
        row = await self.db.one(
            select(self.events).where(
                self.events.c.user_id == uid, self.db.exact(self.events.c.request_id, request_id)
            ),
            c,
        )
        if row:
            if (
                row["payload_hash"] != payload_hash
                or row["kind"] != kind
                or (action_id and row["action_id"] != action_id)
            ):
                raise ApiError("REQUEST_CONFLICT", 409)
            return dict(row), True
        value = dict(
            id=identifier(),
            user_id=uid,
            request_id=request_id,
            kind=kind,
            payload_hash=payload_hash,
            payload_json=dumps(payload),
            job_id=job_id,
            action_id=action_id,
            created_at=now_ms(),
        )
        await c.execute(self.events.insert().values(**value))
        return value, False

    async def account(self, uid, account, c=None):
        user = await self.db.user(uid, c)
        if not user or not hmac.compare_digest(
            str(user.get("unique_id") or "").encode(), account.encode()
        ):
            raise ApiError("ACCOUNT_MISMATCH", 403)
        return user

    async def scope(self, uid, c=None):
        user = await self.db.user(uid, c)
        resume = await self.db.resume(uid, c)
        config = await self.db.ai_config(uid, c)
        # Secrets enter a one-way fingerprint, never job/checkpoint/public payloads.
        effective = effective_config(self.settings, config)
        model_scope = effective.fingerprint()
        controls = self.db.table("py_api_control")
        routing = await self.db.one(
            select(controls.c.value_json).where(
                controls.c.user_id == uid, controls.c.control_key == quota_scope(effective)
            ),
            c,
        )
        return digest(
            [
                loads((user or {}).get("preference"), {}),
                (user or {}).get("ai_seat_status"),
                (resume or {}).get("id"),
                (resume or {}).get("resume_content"),
                model_scope,
                loads(routing["value_json"], {}).get("config") if routing else None,
                await self.db.control(uid, "automation:authority-epoch", 0, c),
                await self.db.control(uid, "career:active-resume", None, c),
                await self.db.control(uid, "career:active-strategy", None, c),
            ]
        )

    async def freeze(self, uid, payload, c):
        user = await self.db.user(uid, c)
        resume = await self.db.resume(uid, c)
        config = await self.db.ai_config(uid, c)
        bundle = {
            "preference": loads(user["preference"], {}),
            "resume": dict(resume) if resume else None,
            "userPrompt": (config or {}).get("user_prompt") or "",
            "scopeHash": await self.scope(uid, c),
            "history": [],
            "rounds": 0,
            "missingMaterials": [],
        }
        # Datetimes are irrelevant to the immutable model bundle and not JSON values.
        if bundle["resume"]:
            bundle["resume"] = {
                k: bundle["resume"].get(k) for k in ("id", "resume_content", "resume_id")
            }
        if payload.kind == "REPLY":
            raw = payload.model_dump(mode="json")
            key = history_key(raw)
            sessions = self.db.table("msg_session")
            session = await self.db.one(
                select(sessions)
                .where(
                    sessions.c.user_id == uid,
                    self.db.exact(sessions.c.session_key, key),
                    sessions.c.is_active.is_(True),
                    sessions.c.status == 1,
                )
                .order_by(sessions.c.id.desc())
                .limit(1),
                c,
            )
            bundle["history"] = safe_history(session["msg_context"]) if session else []
            bundle["rounds"], _ = await current_rounds(self.db, uid, raw, c)
            if not resume:
                bundle["missingMaterials"].append("RESUME")
        elif self.settings.career_enabled:
            from ..career.strategies import Strategies

            await Strategies(self.db, self.settings).application_selection(uid, payload, bundle, c)
        elif payload.input.preparedResumeVersionId or payload.input.strategyPlanId:
            bundle["missingMaterials"].append("PREPARED_VERSION_OR_STRATEGY_NOT_AVAILABLE")
        return bundle

    def action_view(self, action):
        return {
            "actionId": action["id"],
            "jobId": action["job_id"],
            "kind": action["kind"],
            "status": action["status"],
            "sequence": action["sequence"],
            "clientMid": action["client_mid"],
            "payload": loads(action["payload_json"], {}),
            "payloadHash": action["payload_hash"],
            "approvalStatus": action["approval_status"],
            "lastErrorCode": action["last_error_code"],
        }

    async def view(self, uid, job, c=None):
        result = loads(job["result_json"])
        raw = loads(job["input_json"], {}).get("input", {})
        display = raw.get("jobInfo") or loads(raw.get("filterInput", {}).get("jobBaseInfo"), {})
        display = display if isinstance(display, dict) else {}

        def label(*keys):
            return next((display[k][:200] for k in keys if isinstance(display.get(k), str)), "")

        return {
            "jobId": job["id"],
            "kind": job["kind"],
            "status": job["status"],
            "phase": job["phase"],
            "revision": job["revision"],
            "inputHash": job["input_hash"],
            "createdAt": job["created_at"],
            "updatedAt": job["updated_at"],
            "lastErrorCode": job["last_error_code"],
            "decision": result.get("decision") if result else None,
            "result": result,
            "actions": [self.action_view(a) for a in await self.action_rows(uid, job["id"], c)],
            "phaseHistory": loads(job["phase_history_json"], []),
            "graphFinalized": bool(job["graph_finalized"]),
            "display": {
                "jobTitle": label("jobTitle", "jobName"),
                "companyName": label("companyName", "brandName"),
                "recruiterName": label("recruiterName", "bossName"),
            },
        }

    async def checked(self, c, job_id, payload, *, terminal=False):
        job = await self.row(self.jobs, self.uid, job_id, c)
        if await self.db.control(self.uid, "career:deleted:" + job_id, None, c):
            raise ApiError("JOB_DELETED", 409)
        if payload.revision != job["revision"] or payload.inputHash != job["input_hash"]:
            raise ApiError("INPUT_CHANGED", 409)
        if (
            not job["lease_token"]
            or not hmac.compare_digest(payload.leaseToken.encode(), job["lease_token"].encode())
            or (job["lease_until"] or 0) < now_ms()
        ):
            raise ApiError("LEASE_LOST", 409)
        if job["status"] != "RUNNING" and not (
            terminal and job["status"] in {"COMPLETED", "FAILED"} and not job["graph_finalized"]
        ):
            raise ApiError("JOB_NOT_RUNNABLE", 409)
        return job

    async def expire_actions(self, c, uid, job):
        for action in await self.action_rows(uid, job["id"], c):
            if action["lease_until"] and action["lease_until"] < now_ms():
                if action["status"] == "LEASED":
                    await self.update_action(
                        c, action, status="QUEUED", lease_token=None, lease_until=None
                    )
                elif action["status"] == "DISPATCHING":
                    await self.update_action(
                        c, action, status="UNKNOWN", last_error_code="RECEIPT_MISSING"
                    )

    async def wait_for(self, uid, job_id, c):
        job = await self.row(self.jobs, uid, job_id, c)
        if job["kind"] == "CAREER_REVIEW":
            return (
                "NONE"
                if await self.db.control(uid, "career:confirmation:" + job_id, None, c)
                else "CONFIRMATION"
            )
        actions = await self.action_rows(uid, job_id, c)
        if any(
            a["approval_status"] == "PENDING" and a["status"] not in ACTION_DONE for a in actions
        ):
            return "CONFIRMATION"
        if any(a["status"] not in ACTION_DONE for a in actions):
            return "EXECUTION"
        return "NONE"

    async def wake(self, c, job):
        if job["last_error_code"] == "INBOUND_ORDER_UNCERTAIN":
            return
        if job["status"] in TERMINAL or job["status"] == "RUNNING":
            return
        wait = await self.wait_for(job["user_id"], job["id"], c)
        actions = await self.action_rows(job["user_id"], job["id"], c)
        if any(a["status"] == "UNKNOWN" for a in actions):
            state = "UNCERTAIN"
        elif job["status"] == "WAITING_CONFIRMATION" and wait != "CONFIRMATION":
            state = "CONFIRMATION_READY"
        elif wait == "NONE" or job["status"] == "UNCERTAIN":
            state = "EXECUTION_READY"
        else:
            return
        await self.update_job(c, job, status=state, available_at=now_ms())
