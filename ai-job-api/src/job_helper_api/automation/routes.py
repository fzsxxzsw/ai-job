import hmac
from typing import Literal

from fastapi import Depends, Header, Query

from ..errors import ApiError, envelope
from . import contracts as dto
from .actions import Actions
from .jobs import Jobs
from .workflow import Workflow


def register_routes(app, require_user, writable):
    def service(kind=Jobs):
        return kind(app.state.db, app.state.settings, app.state.model, app.state.notifier)

    async def enabled(uid=Depends(writable)):
        if not app.state.settings.automation_enabled:
            raise ApiError("AUTOMATION_DISABLED", 503)
        return uid

    async def internal(token: str | None = Header(default=None, alias="X-Internal-Token")):
        cfg = app.state.settings
        if (
            not cfg.outcome_internal_token
            or not token
            or not hmac.compare_digest(token.encode(), cfg.outcome_internal_token.encode())
        ):
            raise ApiError("INTERNAL_UNAUTHORIZED", 401)
        if not (cfg.automation_enabled or cfg.career_enabled):
            raise ApiError("AUTOMATION_DISABLED", 503)
        if cfg.read_only:
            raise ApiError("READ_ONLY", 503)
        if not await app.state.db.health():
            raise ApiError("DEPENDENCY_UNAVAILABLE", 503)
        if not await app.state.db.user(cfg.owner_user_id):
            raise ApiError("OWNER_INACTIVE", 403)

    from ..career.routes import register_career_routes

    register_career_routes(app, require_user, writable, internal)

    @app.get("/api/job/automation/status")
    async def status(uid=Depends(require_user)):
        return envelope(await service().status(uid))

    @app.post("/api/job/automation/jobs")
    async def submit(payload: dto.JobInput, uid=Depends(enabled)):
        return envelope(await service().submit(uid, payload))

    @app.get("/api/job/automation/jobs")
    async def listing(
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
        kind: Literal["REPLY", "APPLICATION", "CAREER_REVIEW"] | None = None,
        conversationKey: str | None = Query(None, max_length=255),
        uid=Depends(require_user),
    ):
        return envelope(await service().listing(uid, limit, offset, kind, conversationKey))

    @app.get("/api/job/automation/jobs/{job_id}")
    async def detail(job_id: str, uid=Depends(require_user)):
        return envelope(await service().detail(uid, job_id))

    @app.post("/api/job/automation/jobs/{job_id}/cancel")
    async def cancel(job_id: str, payload: dto.RequestId, uid=Depends(enabled)):
        return envelope(await service().cancel(uid, job_id, payload))

    @app.post("/api/job/automation/executors/heartbeat")
    async def executor_heartbeat(payload: dto.ExecutorHeartbeat, uid=Depends(enabled)):
        return envelope(await service(Actions).heartbeat(uid, payload))

    @app.post("/api/job/automation/actions/claim")
    async def action_claim(payload: dto.ActionClaim, uid=Depends(enabled)):
        return envelope(await service(Actions).claim(uid, payload))

    @app.post("/api/job/automation/actions/{action_id}/dispatch")
    async def dispatch(action_id: str, payload: dto.Dispatch, uid=Depends(enabled)):
        return envelope(await service(Actions).dispatch(uid, action_id, payload))

    @app.post("/api/job/automation/actions/{action_id}/receipt")
    async def receipt(action_id: str, payload: dto.Receipt, uid=Depends(writable)):
        return envelope(await service(Actions).receipt(uid, action_id, payload))

    @app.post("/api/job/automation/actions/{action_id}/binding")
    async def binding(action_id: str, payload: dto.ResolveBinding, uid=Depends(writable)):
        return envelope(await service(Actions).binding(uid, action_id, payload))

    @app.post("/api/job/automation/actions/{action_id}/approval")
    async def approval(action_id: str, payload: dto.Approval, uid=Depends(enabled)):
        return envelope(await service(Actions).approval(uid, action_id, payload))

    @app.post("/internal/automation/heartbeat", dependencies=[Depends(internal)])
    async def heartbeat(payload: dto.Heartbeat):
        return envelope(await service(Workflow).heartbeat(payload))

    @app.post("/internal/automation/claim", dependencies=[Depends(internal)])
    async def claim(payload: dto.Worker):
        return envelope(await service(Workflow).claim(payload))

    @app.post("/internal/automation/jobs/{job_id}/renew", dependencies=[Depends(internal)])
    async def renew(job_id: str, payload: dto.Lease):
        return envelope(await service(Workflow).renew(job_id, payload))

    @app.post("/internal/automation/jobs/{job_id}/gather", dependencies=[Depends(internal)])
    async def gather(job_id: str, payload: dto.Lease):
        return envelope(await service(Workflow).gather(job_id, payload))

    @app.post("/internal/automation/jobs/{job_id}/compute", dependencies=[Depends(internal)])
    async def compute(job_id: str, payload: dto.Lease):
        return envelope(await service(Workflow).compute(job_id, payload))

    @app.post("/internal/automation/jobs/{job_id}/validate", dependencies=[Depends(internal)])
    async def validate(job_id: str, payload: dto.Artifact):
        return envelope(await service(Workflow).validate(job_id, payload))

    @app.post("/internal/automation/jobs/{job_id}/commit", dependencies=[Depends(internal)])
    async def commit(job_id: str, payload: dto.Artifact):
        return envelope(await service(Workflow).commit(job_id, payload))

    @app.post("/internal/automation/jobs/{job_id}/park", dependencies=[Depends(internal)])
    async def park(job_id: str, payload: dto.Park):
        return envelope(await service(Workflow).park(job_id, payload))

    @app.post("/internal/automation/jobs/{job_id}/complete", dependencies=[Depends(internal)])
    async def complete(job_id: str, payload: dto.Artifact):
        return envelope(await service(Workflow).complete(job_id, payload))

    @app.post("/internal/automation/jobs/{job_id}/graph-complete", dependencies=[Depends(internal)])
    async def graph_complete(job_id: str, payload: dto.Artifact):
        return envelope(await service(Workflow).graph_complete(job_id, payload))

    @app.post("/internal/automation/jobs/{job_id}/retry", dependencies=[Depends(internal)])
    async def retry(job_id: str, payload: dto.Retry):
        return envelope(await service(Workflow).retry(job_id, payload))
