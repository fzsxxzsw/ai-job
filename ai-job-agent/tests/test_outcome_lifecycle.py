import time

import httpx
import job_helper_agent.main as agent_main
from fastapi.testclient import TestClient
from job_helper_agent.config import AgentConfig
from job_helper_agent.outcome_client import OutcomeAPIClient
from test_outcome_client import TOKEN
from test_outcome_worker import FakeOutcomeAPI


def test_lifespan_starts_real_graph_and_scanner_before_any_business_request(
    tmp_path, monkeypatch
):
    peer = FakeOutcomeAPI()
    monkeypatch.setattr(
        agent_main,
        "OutcomeAPIClient",
        lambda url, token: OutcomeAPIClient(
            url, token, transport=httpx.MockTransport(peer.handle)
        ),
    )
    app = agent_main.create_app(
        AgentConfig(
            outcomes_enabled=True,
            outcome_internal_token=TOKEN,
            checkpoint_path=tmp_path / "lifespan.sqlite3",
        )
    )
    with TestClient(app) as client:
        deadline = time.monotonic() + 3
        while peer.status != "WAITING_CONFIRMATION" and time.monotonic() < deadline:
            time.sleep(0.01)
        assert peer.status == "WAITING_CONFIRMATION"
        response = client.get("/health/ready")
        assert response.status_code == 200
        body = response.json()
        assert body["checks"]["outcomeGraph"] == "compiled"
        assert body["checks"]["outcomeWorker"] == "running"
        assert body["outcomes"]["lastSuccessfulClaimAt"] > 0
        assert body["outcomes"]["lastErrorCode"] is None
        assert body["outcomes"]["workerRunning"]
        assert TOKEN not in response.text
        worker = app.state.outcome_worker
    assert not worker.running
    assert not app.state.graph_ready
    assert peer.report_count == 1


def test_health_exposes_fixed_auth_error_and_liveness_stays_independent(
    tmp_path, monkeypatch
):
    peer = FakeOutcomeAPI()
    peer.fail_before["claim"] = (401, TOKEN)
    monkeypatch.setattr(
        agent_main,
        "OutcomeAPIClient",
        lambda url, token: OutcomeAPIClient(
            url, token, transport=httpx.MockTransport(peer.handle)
        ),
    )
    app = agent_main.create_app(
        AgentConfig(
            outcomes_enabled=True,
            outcome_internal_token=TOKEN,
            checkpoint_path=tmp_path / "unavailable.sqlite3",
        )
    )
    with TestClient(app) as client:
        deadline = time.monotonic() + 2
        while (
            app.state.outcome_worker.last_error is None and time.monotonic() < deadline
        ):
            time.sleep(0.01)
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert response.json()["outcomes"]["lastErrorCode"] == "AUTH_UNAVAILABLE"
        assert response.json()["outcomes"]["lastSuccessfulClaimAt"] is None
        assert response.json()["checks"]["outcomeGraph"] == "compiled"
        assert client.get("/health/live").status_code == 200
        assert peer.calls["claim"] == 1
        assert TOKEN not in response.text
