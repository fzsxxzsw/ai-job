import hmac

from fastapi import Depends, Header, Query, Request

from ..errors import ApiError, envelope
from .contracts import (
    Analyze,
    Artifact,
    Claim,
    Complete,
    Feedback,
    Lease,
    ObservationBatch,
    Park,
    Retry,
)
from .workflow import OutcomeWorkflow


def register_routes(app, require_user, writable):
    def service():
        return OutcomeWorkflow(app.state.db, app.state.settings, app.state.model)

    async def enabled(uid=Depends(writable)):
        if not app.state.settings.outcome_enabled:
            raise ApiError("投递结果分析暂未启用", 503)
        return uid

    async def internal(
        request: Request, token: str | None = Header(default=None, alias="X-Internal-Token")
    ):
        settings = app.state.settings
        expected = settings.outcome_internal_token
        if not expected or token is None or not hmac.compare_digest(token, expected):
            raise ApiError("INTERNAL_AUTH_REQUIRED", 401)
        if not settings.outcome_enabled:
            raise ApiError("OUTCOME_DISABLED", 503)
        if settings.read_only:
            raise ApiError("READ_ONLY", 503)
        if not await app.state.db.health():
            raise ApiError("DEPENDENCY_UNAVAILABLE", 503)
        if not await app.state.db.user(settings.owner_user_id):
            raise ApiError("OWNER_INACTIVE", 403)

    @app.post("/api/job/outcomes/observations")
    async def observations(payload: ObservationBatch, uid=Depends(enabled)):
        return envelope(await service().ingest(uid, payload))

    @app.get("/api/job/outcomes/cases")
    async def cases(
        limit: int = Query(default=20, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        uid=Depends(require_user),
    ):
        return envelope(await service().listing(uid, limit=limit, offset=offset))

    @app.get("/api/job/outcomes/cases/{case_id}/history")
    async def history(case_id: str, uid=Depends(require_user)):
        return envelope(await service().history(uid, case_id))

    @app.get("/api/job/outcomes/cases/{case_id}")
    async def detail(case_id: str, uid=Depends(require_user)):
        return envelope(await service().detail(uid, case_id))

    @app.get("/api/job/outcomes/tasks")
    async def tasks(
        caseId: str | None = None,
        limit: int = Query(default=20, ge=1, le=100),
        offset: int = Query(default=0, ge=0),
        uid=Depends(require_user),
    ):
        return envelope(
            await service().listing(uid, tasks=True, case_id=caseId, limit=limit, offset=offset)
        )

    @app.get("/api/job/outcomes/tasks/{job_id}")
    async def task(job_id: str, uid=Depends(require_user)):
        return envelope(await service().detail(uid, job_id, tasks=True))

    @app.post("/api/job/outcomes/reports/{report_id}/feedback")
    async def feedback(report_id: str, payload: Feedback, uid=Depends(enabled)):
        return envelope(await service().feedback(uid, report_id, payload))

    @app.post("/internal/outcomes/claim", dependencies=[Depends(internal)])
    async def claim(payload: Claim):
        return envelope(await service().claim(payload))

    @app.post("/internal/outcomes/jobs/{job_id}/renew", dependencies=[Depends(internal)])
    async def renew(job_id: str, payload: Lease):
        return envelope(await service().renew(job_id, payload))

    @app.post("/internal/outcomes/jobs/{job_id}/analyze", dependencies=[Depends(internal)])
    async def analyze(job_id: str, payload: Analyze):
        return envelope(await service().analyze(job_id, payload))

    @app.post("/internal/outcomes/jobs/{job_id}/validate", dependencies=[Depends(internal)])
    async def validate(job_id: str, payload: Artifact):
        return envelope(await service().validate(job_id, payload))

    @app.post("/internal/outcomes/jobs/{job_id}/commit", dependencies=[Depends(internal)])
    async def commit(job_id: str, payload: Artifact):
        return envelope(await service().commit(job_id, payload))

    @app.post("/internal/outcomes/jobs/{job_id}/park", dependencies=[Depends(internal)])
    async def park(job_id: str, payload: Park):
        return envelope(await service().park(job_id, payload))

    @app.post("/internal/outcomes/jobs/{job_id}/complete", dependencies=[Depends(internal)])
    async def complete(job_id: str, payload: Complete):
        return envelope(await service().complete(job_id, payload))

    @app.post("/internal/outcomes/jobs/{job_id}/retry", dependencies=[Depends(internal)])
    async def retry(job_id: str, payload: Retry):
        return envelope(await service().retry(job_id, payload))
