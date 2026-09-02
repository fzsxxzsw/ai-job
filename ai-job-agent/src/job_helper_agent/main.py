from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, status

from job_helper_agent.config import AgentConfig, load_config
from job_helper_agent.decision_graph import DecisionState, build_decision_graph
from job_helper_agent.models import JobDecisionRequest, JobDecisionResponse


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    config = load_config()
    app.state.config = config
    app.state.decision_graph = build_decision_graph()
    app.state.graph_ready = True
    try:
        yield
    finally:
        app.state.graph_ready = False


def create_app() -> FastAPI:
    application = FastAPI(
        title="Job Helper Agent",
        version="0.1.0",
        lifespan=lifespan,
    )

    @application.get("/health/live")
    async def health_live() -> dict[str, str]:
        return {"status": "alive", "service": "job-helper-agent"}

    @application.get("/health/ready")
    async def health_ready(request: Request, response: Response) -> dict[str, object]:
        graph_ready = bool(getattr(request.app.state, "graph_ready", False))
        config_valid = isinstance(getattr(request.app.state, "config", None), AgentConfig)
        readiness_status = "ready" if graph_ready and config_valid else "not_ready"
        if readiness_status == "not_ready":
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": readiness_status,
            "checks": {
                "graph": "compiled" if graph_ready else "unavailable",
                "config": "valid" if config_valid else "invalid",
            },
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

    return application


app = create_app()
