from typing import Annotated

from fastapi import Depends, Query
from pydantic import BeforeValidator

from ..automation import contracts as automation
from ..errors import ApiError, envelope
from . import contracts as dto
from .cleanup import Cleanup


def parse_window_query(value: object) -> object:
    # Query values arrive as text; avoid coercing decimals or unsupported spellings.
    if isinstance(value, str) and value in {"7", "14", "30"}:
        return int(value)
    return value


WindowQuery = Annotated[dto.Window, BeforeValidator(parse_window_query)]


def register_career_routes(app, require_user, writable, internal):
    def service():
        return Cleanup(app.state.db, app.state.settings, app.state.model, app.state.notifier)

    async def enabled(uid=Depends(writable)):
        if not app.state.settings.career_enabled:
            raise ApiError("CAREER_DISABLED", 503)
        return uid

    @app.get("/api/job/career/selection")
    async def selection(uid=Depends(require_user)):
        return envelope(await service().selection(uid))

    @app.post("/api/job/career/resumes/versions")
    async def create_version(payload: dto.VersionInput, uid=Depends(enabled)):
        return envelope(await service().create_version(uid, payload))

    @app.get("/api/job/career/resumes/versions")
    async def versions(
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
        uid=Depends(require_user),
    ):
        return envelope(await service().version_list(uid, limit, offset))

    @app.get("/api/job/career/resumes/versions/{ident}")
    async def version(ident: str, uid=Depends(require_user)):
        instance = service()
        return envelope(
            await instance.version_view(uid, await instance.row(instance.versions, uid, ident))
        )

    @app.post("/api/job/career/resumes/versions/{ident}/select")
    async def select_version(ident: str, payload: dto.SelectVersion, uid=Depends(enabled)):
        return envelope(await service().select_version(uid, ident, payload))

    @app.get("/api/job/career/applications")
    async def applications(
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
        uid=Depends(require_user),
    ):
        return envelope(await service().application_list(uid, limit, offset))

    @app.get("/api/job/career/applications/{ident}")
    async def application(ident: str, uid=Depends(require_user)):
        instance = service()
        return envelope(
            await instance.application_view(
                uid, await instance.row(instance.applications, uid, ident), detail=True
            )
        )

    @app.post("/api/job/career/applications/{ident}/events")
    async def event(ident: str, payload: dto.EventInput, uid=Depends(enabled)):
        return envelope(await service().add_event(uid, ident, payload))

    @app.post("/api/job/career/imports/legacy")
    async def import_legacy(payload: automation.RequestId, uid=Depends(enabled)):
        return envelope(await service().import_legacy(uid, payload))

    @app.get("/api/job/career/analytics")
    async def analytics(
        windowDays: WindowQuery = 14,
        cutoff: int | None = Query(None, gt=0),
        resumeVersionId: str | None = None,
        strategyPlanId: str | None = None,
        jobGroup: str | None = None,
        uid=Depends(require_user),
    ):
        return envelope(
            await service().analytics(
                uid, windowDays, cutoff, resumeVersionId, strategyPlanId, jobGroup
            )
        )

    @app.post("/api/job/career/reviews")
    async def review(payload: dto.ReviewInput, uid=Depends(enabled)):
        return envelope(await service().submit_review(uid, payload))

    @app.get("/api/job/career/reviews/{ident}")
    async def review_view(ident: str, uid=Depends(require_user)):
        return envelope(await service().review_view(uid, ident))

    @app.post("/api/job/career/reviews/{ident}/confirmation")
    async def confirmation(ident: str, payload: dto.ConfirmReview, uid=Depends(enabled)):
        return envelope(await service().confirm_review(uid, ident, payload))

    @app.delete("/api/job/career/reviews/{ident}")
    async def delete(ident: str, uid=Depends(writable)):
        return envelope(await service().delete_review(uid, ident))

    @app.post("/api/job/career/proposals/{ident}/preview")
    async def preview(ident: str, payload: dto.Preview, uid=Depends(enabled)):
        return envelope(await service().proposal_preview(uid, ident, payload))

    @app.post("/api/job/career/proposals/{ident}/accept")
    async def accept(ident: str, payload: dto.Accept, uid=Depends(enabled)):
        return envelope(await service().accept_proposal(uid, ident, payload))

    @app.get("/api/job/career/strategies")
    async def strategies(
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
        uid=Depends(require_user),
    ):
        from sqlalchemy import select

        instance = service()
        rows = await instance.db.rows(
            select(instance.strategies)
            .where(instance.strategies.c.user_id == uid)
            .order_by(instance.strategies.c.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return envelope([instance.strategy_view(row) for row in rows])

    @app.get("/api/job/career/strategies/{ident}")
    async def strategy(ident: str, uid=Depends(require_user)):
        instance = service()
        return envelope(instance.strategy_view(await instance.row(instance.strategies, uid, ident)))

    @app.post("/api/job/career/strategies/{ident}/approve")
    async def approve(ident: str, payload: dto.ApproveStrategy, uid=Depends(enabled)):
        return envelope(await service().select_strategy(uid, ident, payload))

    @app.post("/api/job/career/strategies/{ident}/apply")
    async def apply(ident: str, payload: dto.ApproveStrategy, uid=Depends(enabled)):
        return envelope(await service().select_strategy(uid, ident, payload, apply=True))

    # Cleanup shares automation auth, independently of the career feature switch.
    @app.post("/internal/automation/cleanup/claim", dependencies=[Depends(internal)])
    async def cleanup_claim(payload: automation.Worker):
        return envelope(await service().cleanup_claim(payload))

    @app.post("/internal/automation/cleanup/{ident}/renew", dependencies=[Depends(internal)])
    async def cleanup_renew(ident: str, payload: dto.CleanupLease):
        return envelope(await service().cleanup_update(ident, payload))

    @app.post("/internal/automation/cleanup/{ident}/complete", dependencies=[Depends(internal)])
    async def cleanup_complete(ident: str, payload: dto.CleanupComplete):
        return envelope(await service().cleanup_update(ident, payload, complete=True))
