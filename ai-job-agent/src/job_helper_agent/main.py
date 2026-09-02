from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import hmac
from pathlib import Path
from uuid import UUID

import aiosqlite
from fastapi import FastAPI, Header, HTTPException, Request, Response, status
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from job_helper_agent.config import AgentConfig, load_config
from job_helper_agent.database import (
    create_engine_and_session,
    database_is_reachable,
    migration_is_current,
)
from job_helper_agent.decision_graph import DecisionState, build_decision_graph
from job_helper_agent.models import (
    ActionProposal,
    JobDecisionRequest,
    JobDecisionResponse,
    ResumeRequest,
    RunCreateRequest,
    RunEventResponse,
    RunHistoryResponse,
    RunResponse,
)
from job_helper_agent.recoverable_graph import build_recoverable_graph
from job_helper_agent.repository import AgentRepository, RunConflict, RunNotFound
from job_helper_agent.service import RecoverableAgentService


STRICT_CHECKPOINT_SERIALIZER = JsonPlusSerializer(
    pickle_fallback=False,
    allowed_msgpack_modules=None,
)


async def refresh_persistence_readiness(app: FastAPI) -> tuple[bool, dict[str, str]]:
    try:
        cursor = await app.state.checkpointer.conn.execute("SELECT 1")
        await cursor.close()
        checkpoint_ok = True
    except Exception:
        checkpoint_ok = False
    database_ok = await database_is_reachable(app.state.database_engine)
    migration_ok = (
        await migration_is_current(app.state.database_engine) if database_ok else False
    )
    ready = checkpoint_ok and database_ok and migration_ok
    app.state.persistence_ready = ready
    return ready, {
        "checkpoint": "writable" if checkpoint_ok else "unavailable",
        "database": "reachable" if database_ok else "unavailable",
        "migration": "current" if migration_ok else "not_current",
    }


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    config: AgentConfig = app.state.config_override or load_config()
    app.state.config = config
    app.state.decision_graph = build_decision_graph()
    app.state.graph_ready = True
    app.state.persistence_ready = False
    if not config.persistence_enabled:
        try:
            yield
        finally:
            app.state.graph_ready = False
        return

    checkpoint_path = Path(config.checkpoint_path)
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_connection = await aiosqlite.connect(str(checkpoint_path))
    saver = AsyncSqliteSaver(checkpoint_connection, serde=STRICT_CHECKPOINT_SERIALIZER)
    try:
        await saver.setup()
        engine, sessions = create_engine_and_session(config.sqlalchemy_url())
        app.state.checkpointer = saver
        app.state.database_engine = engine
        app.state.repository = AgentRepository(sessions)
        app.state.recoverable_graph = build_recoverable_graph(saver)
        app.state.agent_service = RecoverableAgentService(
            config=config,
            graph=app.state.recoverable_graph,
            repository=app.state.repository,
        )
        await refresh_persistence_readiness(app)
        try:
            yield
        finally:
            app.state.persistence_ready = False
            app.state.graph_ready = False
            await engine.dispose()
    finally:
        await checkpoint_connection.close()


def create_app(config: AgentConfig | None = None) -> FastAPI:
    application = FastAPI(
        title="Job Helper Agent",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.state.config_override = config

    @application.get("/health/live")
    async def health_live() -> dict[str, str]:
        return {"status": "alive", "service": "job-helper-agent"}

    @application.get("/health/ready")
    async def health_ready(request: Request, response: Response) -> dict[str, object]:
        graph_ready = bool(getattr(request.app.state, "graph_ready", False))
        config_valid = isinstance(getattr(request.app.state, "config", None), AgentConfig)
        checks: dict[str, str] = {
            "graph": "compiled" if graph_ready else "unavailable",
            "config": "valid" if config_valid else "invalid",
        }
        persistence_ok = True
        config_value = getattr(request.app.state, "config", None)
        if isinstance(config_value, AgentConfig) and config_value.persistence_enabled:
            persistence_ok, persistence_checks = await refresh_persistence_readiness(request.app)
            checks.update(persistence_checks)
        readiness_status = "ready" if graph_ready and config_valid and persistence_ok else "not_ready"
        if readiness_status == "not_ready":
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": readiness_status,
            "checks": checks,
        }

    @application.post(
        "/api/v1/job-decisions",
        response_model=JobDecisionResponse,
    )
    async def decide_job(
        decision_request: JobDecisionRequest,
        request: Request,
    ) -> JobDecisionResponse:
        config: AgentConfig = request.app.state.config
        initial_state: DecisionState = {
            **decision_request.model_dump(),
            "policy_version": config.policy_version,
        }
        result = await request.app.state.decision_graph.ainvoke(initial_state)
        return JobDecisionResponse(
            decision=result["decision"],
            reasons=result["reasons"],
            evidence=result["evidence"],
            policy_version=result["policy_version"],
        )

    async def require_internal_token(
        request: Request,
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> None:
        config_value: AgentConfig = request.app.state.config
        if not config_value.persistence_enabled:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="persistent Agent API is disabled",
            )
        expected = config_value.internal_token.get_secret_value()
        if x_internal_token is None or not hmac.compare_digest(x_internal_token, expected):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
        persistence_ready, _ = await refresh_persistence_readiness(request.app)
        if not persistence_ready:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="persistent Agent dependencies are not ready",
            )

    def run_response(run) -> RunResponse:
        return RunResponse(
            run_id=run.run_id,
            request_id=run.request_id,
            status=run.status,
            decision=run.decision,
            proposal=ActionProposal.model_validate(run.proposal_json)
            if run.proposal_json
            else None,
            interrupt_id=run.interrupt_id,
            result=run.result_json,
            policy_version=run.policy_version,
            graph_version=run.graph_version,
        )

    async def map_repository_error(operation):
        try:
            return await operation
        except RunNotFound as error:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
        except RunConflict as error:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error

    @application.post("/api/v1/runs", response_model=RunResponse)
    async def create_run(
        payload: RunCreateRequest,
        request: Request,
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> RunResponse:
        await require_internal_token(request, x_internal_token)
        run = await map_repository_error(request.app.state.agent_service.create_run(payload))
        return run_response(run)

    @application.post("/api/v1/runs/{run_id}/resume", response_model=RunResponse)
    async def resume_run(
        run_id: UUID,
        payload: ResumeRequest,
        request: Request,
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> RunResponse:
        await require_internal_token(request, x_internal_token)
        run = await map_repository_error(
            request.app.state.agent_service.resume_run(str(run_id), payload)
        )
        return run_response(run)

    @application.get("/api/v1/runs/{run_id}", response_model=RunResponse)
    async def get_run(
        run_id: UUID,
        request: Request,
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> RunResponse:
        await require_internal_token(request, x_internal_token)
        repository = request.app.state.repository
        run = await map_repository_error(repository.get_run(str(run_id), request.app.state.config.subject_ref))
        run = await map_repository_error(request.app.state.agent_service.reconcile_run(run))
        return run_response(run)

    @application.get("/api/v1/runs/{run_id}/history", response_model=RunHistoryResponse)
    async def get_run_history(
        run_id: UUID,
        request: Request,
        x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    ) -> RunHistoryResponse:
        await require_internal_token(request, x_internal_token)
        events = await map_repository_error(
            request.app.state.repository.list_events(
                str(run_id), request.app.state.config.subject_ref
            )
        )
        return RunHistoryResponse(
            run_id=run_id,
            events=[
                RunEventResponse(
                    event_id=event.event_id,
                    seq=event.seq,
                    event_type=event.event_type,
                    payload=event.payload_json,
                    occurred_at=event.occurred_at.isoformat(timespec="microseconds") + "Z",
                )
                for event in events
            ],
        )

    return application


app = create_app()
