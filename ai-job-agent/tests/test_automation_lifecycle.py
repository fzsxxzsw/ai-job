import time

import httpx
import job_helper_agent.main as agent_main
from fastapi.testclient import TestClient
from job_helper_agent.automation_client import AutomationAPIClient
from job_helper_agent.config import AgentConfig
from test_automation_worker import TOKEN, FakeAutomationAPI


def test_lifespan_compiles_three_graphs_scans_and_exposes_live_heartbeat(
    tmp_path, monkeypatch
):
    peer = FakeAutomationAPI(execution=False)
    monkeypatch.setattr(
        agent_main,
        "AutomationAPIClient",
        lambda url, token: AutomationAPIClient(
            url, token, transport=httpx.MockTransport(peer.handle)
        ),
    )
    app = agent_main.create_app(
        AgentConfig(
            automation_enabled=True,
            outcome_internal_token=TOKEN,
            checkpoint_path=tmp_path / "lifecycle.sqlite3",
        )
    )
    with TestClient(app) as client:
        deadline = time.monotonic() + 3
        while (
            app.state.automation_worker.last_completed_at is None
            and time.monotonic() < deadline
        ):
            time.sleep(0.01)
        assert peer.status == "COMPLETED"
        response = client.get("/health/ready")
        assert response.status_code == 200
        body = response.json()
        assert body["checks"]["automationGraph"] == "compiled"
        assert body["checks"]["automationWorker"] == "running"
        assert body["automation"]["graphs"] == ["APPLICATION", "CAREER_REVIEW", "REPLY"]
        assert body["automation"]["lastHeartbeatAt"] > 0
        assert body["automation"]["lastSuccessfulClaimAt"] > 0
        assert body["automation"]["lastCompletedAt"] > 0
        assert TOKEN not in response.text
        assert client.get("/health/live").status_code == 200
        worker = app.state.automation_worker
    assert not worker.running and not app.state.graph_ready


def test_auth_failure_is_not_ready_and_never_exposes_credentials(tmp_path, monkeypatch):
    peer = FakeAutomationAPI()
    peer.fail_before = {"claim": (401, TOKEN), "heartbeat": (401, TOKEN)}
    monkeypatch.setattr(
        agent_main,
        "AutomationAPIClient",
        lambda url, token: AutomationAPIClient(
            url, token, transport=httpx.MockTransport(peer.handle)
        ),
    )
    app = agent_main.create_app(
        AgentConfig(
            automation_enabled=True,
            outcome_internal_token=TOKEN,
            checkpoint_path=tmp_path / "auth.sqlite3",
        )
    )
    with TestClient(app) as client:
        deadline = time.monotonic() + 2
        while (
            app.state.automation_worker.last_error is None
            and time.monotonic() < deadline
        ):
            time.sleep(0.01)
        response = client.get("/health/ready")
        assert response.status_code == 503
        body = response.json()["automation"]
        assert body["lastErrorCode"] == "INTERNAL_UNAUTHORIZED"
        assert body["lastHeartbeatAt"] is None and body["lastCompletedAt"] is None
        assert TOKEN not in response.text
        assert client.get("/health/live").status_code == 200
