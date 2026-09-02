import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from langgraph.types import Command
from pydantic import ValidationError
from sqlalchemy import func, select, update

from job_helper_agent.config import AgentConfig
from job_helper_agent.database import (
    AgentAction,
    AgentApproval,
    AgentRun,
    action_idempotency_key,
    create_engine_and_session,
    sha256_json,
)
from job_helper_agent.main import STRICT_CHECKPOINT_SERIALIZER, create_app
import job_helper_agent.main as agent_main
from job_helper_agent.recoverable_graph import build_recoverable_graph
from job_helper_agent.repository import RunConflict


DATABASE_URL = os.getenv("AGENT_TEST_DATABASE_URL")
TOKEN = "integration-token-not-a-production-secret-000000000000"


class SlowInvokeGraph:
    def __init__(self, graph, delay: float):
        self._graph = graph
        self._delay = delay

    async def ainvoke(self, *args, **kwargs):
        await asyncio.sleep(self._delay)
        return await self._graph.ainvoke(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._graph, name)


def test_persistent_configuration_fails_closed_without_token_or_database() -> None:
    with pytest.raises(ValidationError, match="AGENT_DATABASE_URL.*AGENT_INTERNAL_TOKEN"):
        AgentConfig(persistence_enabled=True)


def test_checkpoint_serializer_is_explicitly_strict() -> None:
    assert STRICT_CHECKPOINT_SERIALIZER.pickle_fallback is False
    assert STRICT_CHECKPOINT_SERIALIZER._allowed_msgpack_modules is None

    class UnregisteredCheckpointType:
        pass

    with pytest.raises(TypeError, match="not msgpack serializable"):
        STRICT_CHECKPOINT_SERIALIZER.dumps_typed(UnregisteredCheckpointType())


def test_action_idempotency_key_is_tuple_unambiguous() -> None:
    assert action_idempotency_key("ab", "c") != action_idempotency_key("a", "bc")
    assert action_idempotency_key("ab", "c") == action_idempotency_key("ab", "c")


def test_database_url_create_preserves_special_character_password() -> None:
    password = "p@ss:/#%word?&=+ with spaces"
    config = AgentConfig(
        persistence_enabled=True,
        database_host="mysql",
        database_port=3306,
        database_user="agent",
        database_password=password,
        database_name="agent_db",
        internal_token="x" * 32,
    )
    url = config.sqlalchemy_url()
    assert url.password == password
    assert url.host == "mysql"


@pytest.mark.skipif(not DATABASE_URL, reason="AGENT_TEST_DATABASE_URL is not configured")
class TestPersistentAgent:
    @staticmethod
    def config(tmp_path: Path, subject: str | None = None) -> AgentConfig:
        return AgentConfig(
            persistence_enabled=True,
            checkpoint_path=tmp_path / "checkpoints.sqlite3",
            database_url=DATABASE_URL,
            internal_token=TOKEN,
            subject_ref=subject or f"test-{uuid4()}",
            resume_lease_seconds=2,
        )

    @staticmethod
    def headers(token: str = TOKEN) -> dict[str, str]:
        return {"X-Internal-Token": token}

    @staticmethod
    def create_payload(**overrides) -> dict[str, object]:
        payload: dict[str, object] = {
            "request_id": str(uuid4()),
            "source_job_ref": f"job-{uuid4().hex}",
            "title": "Python Backend Engineer",
            "description": "Build reliable FastAPI services",
            "excluded_keywords": [],
            "required_keywords": ["python"],
        }
        payload.update(overrides)
        return payload

    @staticmethod
    def resume_payload(run: dict[str, object], decision: str = "APPROVE", **overrides):
        proposal = run["proposal"]
        payload = {
            "proposal_id": proposal["proposal_id"],
            "interrupt_id": run["interrupt_id"],
            "preview_hash": proposal["preview_hash"],
            "decision_request_id": str(uuid4()),
            "decision": decision,
            "reason": "human reviewed the preview",
        }
        payload.update(overrides)
        return payload

    @staticmethod
    def db_scalar(statement):
        async def query():
            engine, sessions = create_engine_and_session(DATABASE_URL)
            try:
                async with sessions() as session:
                    return await session.scalar(statement)
            finally:
                await engine.dispose()

        return asyncio.run(query())

    def test_auth_extra_fields_and_openapi_expose_no_executor(self, tmp_path: Path) -> None:
        app = create_app(self.config(tmp_path))
        with TestClient(app) as client:
            payload = self.create_payload()
            assert client.post("/api/v1/runs", json=payload).status_code == 401
            assert (
                client.post(
                    "/api/v1/runs", json=payload, headers=self.headers("wrong-token")
                ).status_code
                == 401
            )
            for forbidden in ("userId", "subject_ref", "thread_id", "selector", "script", "url", "cookie"):
                invalid = {**payload, forbidden: "attacker-controlled"}
                assert client.post(
                    "/api/v1/runs", json=invalid, headers=self.headers()
                ).status_code == 422
            schema = client.get("/openapi.json").json()

        paths = set(schema["paths"])
        assert not any(
            word in path.casefold()
            for path in paths
            for word in ("executor", "claim", "dispatch", "result", "retry")
        )
        property_names: set[str] = set()

        def collect_properties(value):
            if isinstance(value, dict):
                property_names.update(value.get("properties", {}).keys())
                for child in value.values():
                    collect_properties(child)
            elif isinstance(value, list):
                for child in value:
                    collect_properties(child)

        collect_properties(schema)
        for forbidden in (
            "userId",
            "subject_ref",
            "thread_id",
            "selector",
            "script",
            "url",
            "cookie",
        ):
            assert forbidden not in property_names

    def test_business_api_returns_503_when_migration_is_not_ready(
        self, tmp_path: Path, monkeypatch
    ) -> None:
        async def migration_missing(_engine):
            return False

        monkeypatch.setattr(agent_main, "migration_is_current", migration_missing)
        with TestClient(create_app(self.config(tmp_path))) as client:
            response = client.post(
                "/api/v1/runs",
                json=self.create_payload(),
                headers=self.headers(),
            )
        assert response.status_code == 503

    def test_create_resume_replay_and_event_sequence(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        payload = self.create_payload()
        with TestClient(app) as client:
            first = client.post("/api/v1/runs", json=payload, headers=self.headers())
            replay = client.post("/api/v1/runs", json=payload, headers=self.headers())
            conflict = client.post(
                "/api/v1/runs",
                json={**payload, "title": "different payload"},
                headers=self.headers(),
            )
            assert first.status_code == replay.status_code == 200
            assert first.json()["run_id"] == replay.json()["run_id"]
            assert first.json()["status"] == "WAITING_APPROVAL"
            assert conflict.status_code == 409

            approval = self.resume_payload(first.json())
            completed = client.post(
                f"/api/v1/runs/{first.json()['run_id']}/resume",
                json=approval,
                headers=self.headers(),
            )
            replayed = client.post(
                f"/api/v1/runs/{first.json()['run_id']}/resume",
                json=approval,
                headers=self.headers(),
            )
            history = client.get(
                f"/api/v1/runs/{first.json()['run_id']}/history", headers=self.headers()
            )

        assert completed.status_code == replayed.status_code == 200
        assert completed.json()["result"]["action_status"] == "QUEUED"
        events = history.json()["events"]
        assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
        assert [event["event_type"] for event in events] == [
            "RUN_CREATED",
            "RUN_STARTED",
            "APPROVAL_REQUESTED",
            "APPROVAL_APPROVED",
            "ACTION_QUEUED",
            "RUN_COMPLETED",
        ]
        assert self.db_scalar(
            select(func.count()).select_from(AgentAction).where(
                AgentAction.subject_ref == config.subject_ref,
                AgentAction.status == "QUEUED",
            )
        ) == 1

    def test_concurrent_create_has_one_graph_execution_owner(self, tmp_path: Path) -> None:
        app = create_app(self.config(tmp_path))
        payload = self.create_payload()
        with TestClient(app) as client:
            def create():
                return client.post("/api/v1/runs", json=payload, headers=self.headers())

            with ThreadPoolExecutor(max_workers=2) as executor:
                responses = list(executor.map(lambda _: create(), range(2)))
            assert [response.status_code for response in responses] == [200, 200]
            assert len({response.json()["run_id"] for response in responses}) == 1
            run_id = responses[0].json()["run_id"]
            events = client.get(
                f"/api/v1/runs/{run_id}/history", headers=self.headers()
            ).json()["events"]
        assert sum(event["event_type"] == "RUN_STARTED" for event in events) == 1

    def test_running_without_checkpoint_redrives_from_persisted_input(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        payload = self.create_payload()
        with TestClient(app) as client:
            seeded_run_id = client.portal.call(
                self._seed_expired_running_without_checkpoint,
                app,
                payload,
                config,
            )
            recovered = client.post(
                "/api/v1/runs", json=payload, headers=self.headers()
            )
        assert recovered.status_code == 200
        assert recovered.json()["run_id"] == seeded_run_id
        assert recovered.json()["status"] == "WAITING_APPROVAL"

    @pytest.mark.parametrize(
        "interrupt_after",
        ["normalize_job", "apply_keyword_policy", "build_contact_proposal"],
    )
    def test_expired_initial_lease_continues_from_each_intermediate_checkpoint(
        self, tmp_path: Path, interrupt_after: str
    ) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        payload = self.create_payload()
        with TestClient(app) as client:
            run_id, before_next = client.portal.call(
                self._seed_initial_intermediate_checkpoint,
                app,
                payload,
                config,
                interrupt_after,
            )
            assert before_next
            recovered = client.get(
                f"/api/v1/runs/{run_id}", headers=self.headers()
            )
        assert recovered.status_code == 200
        assert recovered.json()["status"] == "WAITING_APPROVAL"
        assert recovered.json()["decision"] == "MATCH"

    def test_active_initial_lease_does_not_advance_intermediate_checkpoint(
        self, tmp_path: Path
    ) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        payload = self.create_payload()
        with TestClient(app) as client:
            run_id, before_next = client.portal.call(
                self._seed_initial_intermediate_checkpoint,
                app,
                payload,
                config,
                "apply_keyword_policy",
                False,
            )
            current = client.get(f"/api/v1/runs/{run_id}", headers=self.headers())
            after_next = client.portal.call(self._checkpoint_next, app, run_id, config)
            client.portal.call(self._expire_execution_lease, app, run_id)
            recovered = client.get(f"/api/v1/runs/{run_id}", headers=self.headers())
        assert current.status_code == 200
        assert current.json()["status"] == "RUNNING"
        assert after_next == before_next
        assert recovered.status_code == 200
        assert recovered.json()["status"] == "WAITING_APPROVAL"

    def test_reject_and_review_never_create_action(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        with TestClient(app) as client:
            rejected = client.post(
                "/api/v1/runs", json=self.create_payload(), headers=self.headers()
            ).json()
            rejected_result = client.post(
                f"/api/v1/runs/{rejected['run_id']}/resume",
                json=self.resume_payload(rejected, decision="REJECT"),
                headers=self.headers(),
            )
            review = client.post(
                "/api/v1/runs",
                json=self.create_payload(required_keywords=["java"]),
                headers=self.headers(),
            )
            policy_reject = client.post(
                "/api/v1/runs",
                json=self.create_payload(
                    description="Python outsourcing role",
                    excluded_keywords=["outsourcing"],
                ),
                headers=self.headers(),
            )

        assert rejected_result.status_code == 200
        assert rejected_result.json()["result"]["action_kind"] is None
        assert review.status_code == 200
        assert review.json()["status"] == "COMPLETED"
        assert review.json()["decision"] == "REVIEW"
        assert policy_reject.status_code == 200
        assert policy_reject.json()["decision"] == "REJECT"
        assert policy_reject.json()["status"] == "COMPLETED"
        assert self.db_scalar(
            select(func.count()).select_from(AgentAction).where(
                AgentAction.subject_ref == config.subject_ref
            )
        ) == 0

    def test_checkpoint_survives_app_restart(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        payload = self.create_payload()
        with TestClient(create_app(config)) as client:
            waiting = client.post(
                "/api/v1/runs", json=payload, headers=self.headers()
            ).json()

        with TestClient(create_app(config)) as restarted:
            completed = restarted.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json=self.resume_payload(waiting),
                headers=self.headers(),
            )
        assert completed.status_code == 200
        assert completed.json()["status"] == "COMPLETED"

    def test_cross_run_action_dedupe_and_approval_conflict(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        source_job_ref = f"same-job-{uuid4().hex}"
        app = create_app(config)
        with TestClient(app) as client:
            first = client.post(
                "/api/v1/runs",
                json=self.create_payload(source_job_ref=source_job_ref),
                headers=self.headers(),
            ).json()
            first_approval = self.resume_payload(first)
            assert client.post(
                f"/api/v1/runs/{first['run_id']}/resume",
                json=first_approval,
                headers=self.headers(),
            ).status_code == 200
            contradictory = {
                **first_approval,
                "decision": "REJECT",
                "decision_request_id": str(uuid4()),
            }
            assert client.post(
                f"/api/v1/runs/{first['run_id']}/resume",
                json=contradictory,
                headers=self.headers(),
            ).status_code == 409

            second = client.post(
                "/api/v1/runs",
                json=self.create_payload(source_job_ref=source_job_ref),
                headers=self.headers(),
            ).json()
            second_result = client.post(
                f"/api/v1/runs/{second['run_id']}/resume",
                json=self.resume_payload(second),
                headers=self.headers(),
            )

        assert second_result.status_code == 200
        assert second_result.json()["result"]["action_deduplicated"] is True
        assert self.db_scalar(
            select(func.count()).select_from(AgentAction).where(
                AgentAction.subject_ref == config.subject_ref
            )
        ) == 1

    def test_outbox_unique_conflict_requires_semantic_equality(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        target = f"semantic-job-{uuid4().hex}"
        app = create_app(config)
        with TestClient(app) as client:
            first = client.post(
                "/api/v1/runs",
                json=self.create_payload(source_job_ref=target),
                headers=self.headers(),
            ).json()
            assert client.post(
                f"/api/v1/runs/{first['run_id']}/resume",
                json=self.resume_payload(first),
                headers=self.headers(),
            ).status_code == 200
            client.portal.call(self._corrupt_existing_action_preview, app, config.subject_ref)
            second = client.post(
                "/api/v1/runs",
                json=self.create_payload(source_job_ref=target),
                headers=self.headers(),
            ).json()
            conflict = client.post(
                f"/api/v1/runs/{second['run_id']}/resume",
                json=self.resume_payload(second),
                headers=self.headers(),
            )
        assert conflict.status_code == 409
        assert self.db_scalar(
            select(func.count()).select_from(AgentApproval).where(
                AgentApproval.subject_ref == config.subject_ref
            )
        ) == 1

    def test_terminal_checkpoint_is_reconciled_after_mysql_gap(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        with TestClient(app) as client:
            waiting = client.post(
                "/api/v1/runs", json=self.create_payload(), headers=self.headers()
            ).json()
            approval = self.resume_payload(waiting)
            output = client.portal.call(
                self._finish_graph_without_mysql,
                app,
                waiting,
                approval,
                config.subject_ref,
            )
            assert not output.interrupts
            opposite = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json={**approval, "decision": "REJECT"},
                headers=self.headers(),
            )
            reconciled = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json=approval,
                headers=self.headers(),
            )
        assert opposite.status_code == 409
        assert reconciled.status_code == 200
        assert reconciled.json()["status"] == "COMPLETED"
        assert reconciled.json()["result"]["action_status"] == "QUEUED"

    def test_expired_resume_lease_continues_finish_checkpoint_without_reapplying_command(
        self, tmp_path: Path
    ) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        with TestClient(app) as client:
            waiting = client.post(
                "/api/v1/runs", json=self.create_payload(), headers=self.headers()
            ).json()
            approval = self.resume_payload(waiting)
            before_next = client.portal.call(
                self._seed_resume_intermediate_checkpoint,
                app,
                waiting,
                approval,
                config,
            )
            active = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json=approval,
                headers=self.headers(),
            )
            active_next = client.portal.call(
                self._checkpoint_next, app, waiting["run_id"], config
            )
            client.portal.call(self._expire_resume_lease, app, waiting["run_id"])
            completed = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json=approval,
                headers=self.headers(),
            )
        assert before_next == ("finish_approval",)
        assert active.status_code == 200
        assert active.json()["status"] == "WAITING_APPROVAL"
        assert active_next == before_next
        assert completed.status_code == 200
        assert completed.json()["status"] == "COMPLETED"
        assert completed.json()["result"]["action_status"] == "QUEUED"

    def test_failed_run_remains_terminal_with_readable_interrupt_checkpoint(
        self, tmp_path: Path
    ) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        with TestClient(app) as client:
            waiting = client.post(
                "/api/v1/runs", json=self.create_payload(), headers=self.headers()
            ).json()
            client.portal.call(
                app.state.repository.fail_run,
                waiting["run_id"],
                config.subject_ref,
                "forced_test_failure",
            )
            current = client.get(
                f"/api/v1/runs/{waiting['run_id']}", headers=self.headers()
            )
            approve = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json=self.resume_payload(waiting),
                headers=self.headers(),
            )
            client.portal.call(
                self._assert_failed_repository_guards,
                app,
                waiting,
                config,
            )
        assert current.status_code == approve.status_code == 200
        assert current.json()["status"] == approve.json()["status"] == "FAILED"
        assert self.db_scalar(
            select(func.count()).select_from(AgentApproval).where(
                AgentApproval.subject_ref == config.subject_ref
            )
        ) == 0
        assert self.db_scalar(
            select(func.count()).select_from(AgentAction).where(
                AgentAction.subject_ref == config.subject_ref
            )
        ) == 0

    def test_completed_approval_replay_requires_exact_reason_without_checkpoint(
        self, tmp_path: Path
    ) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        with TestClient(app) as client:
            waiting = client.post(
                "/api/v1/runs", json=self.create_payload(), headers=self.headers()
            ).json()
            approval = self.resume_payload(waiting)
            completed = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json=approval,
                headers=self.headers(),
            )
            assert completed.status_code == 200
            client.portal.call(
                self._delete_thread_checkpoint, app, waiting["run_id"], config
            )
            exact_replay = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json=approval,
                headers=self.headers(),
            )
            changed_reason = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json={**approval, "reason": "a different human reason"},
                headers=self.headers(),
            )
        assert exact_replay.status_code == 200
        assert changed_reason.status_code == 409

    def test_missing_waiting_checkpoint_fails_with_audit(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        app = create_app(config)
        with TestClient(app) as client:
            waiting = client.post(
                "/api/v1/runs", json=self.create_payload(), headers=self.headers()
            ).json()
            client.portal.call(self._delete_thread_checkpoint, app, waiting["run_id"], config)
            response = client.post(
                f"/api/v1/runs/{waiting['run_id']}/resume",
                json=self.resume_payload(waiting),
                headers=self.headers(),
            )
            failed = client.portal.call(
                app.state.repository.get_run, waiting["run_id"], config.subject_ref
            )
            history = client.get(
                f"/api/v1/runs/{waiting['run_id']}/history", headers=self.headers()
            ).json()["events"]
        assert response.status_code == 409
        assert failed.status == "FAILED"
        assert history[-1]["event_type"] == "RUN_FAILED"

    @staticmethod
    async def _finish_graph_without_mysql(app, waiting, approval, subject_ref):
        run = await app.state.repository.get_run(waiting["run_id"], subject_ref)
        return await app.state.recoverable_graph.ainvoke(
            Command(
                resume={
                    waiting["interrupt_id"]: {
                        "decision": approval["decision"],
                        "decision_request_id": approval["decision_request_id"],
                        "reason": approval["reason"],
                    }
                }
            ),
            {"configurable": {"thread_id": run.thread_id}},
            version="v2",
        )

    @staticmethod
    async def _seed_expired_running_without_checkpoint(app, payload, config) -> str:
        run_id = str(uuid4())
        thread_id = str(uuid4())
        input_json = dict(payload)
        run, _ = await app.state.repository.create_or_get_run(
            run_id=run_id,
            thread_id=thread_id,
            subject_ref=config.subject_ref,
            source_job_ref=payload["source_job_ref"],
            request_id=payload["request_id"],
            fingerprint=sha256_json(input_json),
            input_json=input_json,
            policy_version=config.policy_version,
            graph_version=config.graph_version,
        )
        _, token = await app.state.repository.claim_execution(
            run_id, config.subject_ref, config.resume_lease_seconds
        )
        assert token is not None
        async with app.state.repository._sessions.begin() as session:
            await session.execute(
                update(AgentRun)
                .where(AgentRun.run_id == run_id)
                .values(
                    execution_lease_until=datetime.now(UTC).replace(tzinfo=None)
                    - timedelta(seconds=1)
                )
            )
        return run.run_id

    @staticmethod
    async def _seed_initial_intermediate_checkpoint(
        app,
        payload,
        config,
        interrupt_after: str,
        expire_lease: bool = True,
    ) -> tuple[str, tuple[str, ...]]:
        run, _ = await app.state.repository.create_or_get_run(
            run_id=str(uuid4()),
            thread_id=str(uuid4()),
            subject_ref=config.subject_ref,
            source_job_ref=payload["source_job_ref"],
            request_id=payload["request_id"],
            fingerprint=sha256_json(payload),
            input_json=payload,
            policy_version=config.policy_version,
            graph_version=config.graph_version,
        )
        run, token = await app.state.repository.claim_execution(
            run.run_id, config.subject_ref, config.resume_lease_seconds
        )
        assert token is not None
        crash_graph = build_recoverable_graph(
            app.state.checkpointer,
            interrupt_after=[interrupt_after],
        )
        await crash_graph.ainvoke(
            app.state.agent_service._initial_state(run),
            {"configurable": {"thread_id": run.thread_id}},
            version="v2",
        )
        snapshot = await crash_graph.aget_state(
            {"configurable": {"thread_id": run.thread_id}}
        )
        assert snapshot.next
        assert not snapshot.interrupts
        if expire_lease:
            await TestPersistentAgent._expire_execution_lease(app, run.run_id)
        return run.run_id, tuple(snapshot.next)

    @staticmethod
    async def _seed_resume_intermediate_checkpoint(
        app, waiting, approval, config
    ) -> tuple[str, ...]:
        run = await app.state.repository.get_run(
            waiting["run_id"], config.subject_ref
        )
        await app.state.repository.acquire_resume_lease(
            run_id=run.run_id,
            subject_ref=config.subject_ref,
            lease_seconds=config.resume_lease_seconds,
        )
        crash_graph = build_recoverable_graph(
            app.state.checkpointer,
            interrupt_after=["request_approval"],
        )
        output = await crash_graph.ainvoke(
            Command(
                resume={
                    waiting["interrupt_id"]: {
                        "decision": approval["decision"],
                        "decision_request_id": approval["decision_request_id"],
                        "reason": approval["reason"],
                    }
                }
            ),
            {"configurable": {"thread_id": run.thread_id}},
            version="v2",
        )
        assert not output.interrupts
        snapshot = await crash_graph.aget_state(
            {"configurable": {"thread_id": run.thread_id}}
        )
        assert snapshot.values["approval_decision"] == approval["decision"]
        assert snapshot.next
        return tuple(snapshot.next)

    @staticmethod
    async def _checkpoint_next(app, run_id: str, config) -> tuple[str, ...]:
        run = await app.state.repository.get_run(run_id, config.subject_ref)
        snapshot = await app.state.recoverable_graph.aget_state(
            {"configurable": {"thread_id": run.thread_id}}
        )
        return tuple(snapshot.next)

    @staticmethod
    async def _expire_execution_lease(app, run_id: str) -> None:
        async with app.state.repository._sessions.begin() as session:
            await session.execute(
                update(AgentRun)
                .where(AgentRun.run_id == run_id)
                .values(
                    execution_lease_until=datetime.now(UTC).replace(tzinfo=None)
                    - timedelta(seconds=1)
                )
            )

    @staticmethod
    async def _expire_resume_lease(app, run_id: str) -> None:
        async with app.state.repository._sessions.begin() as session:
            await session.execute(
                update(AgentRun)
                .where(AgentRun.run_id == run_id)
                .values(
                    resume_lease_until=datetime.now(UTC).replace(tzinfo=None)
                    - timedelta(seconds=1)
                )
            )

    @staticmethod
    async def _assert_failed_repository_guards(app, waiting, config) -> None:
        run = await app.state.repository.get_run(
            waiting["run_id"], config.subject_ref
        )
        with pytest.raises(RunConflict, match="failed run is terminal"):
            await app.state.repository.mark_waiting(
                run_id=run.run_id,
                subject_ref=config.subject_ref,
                decision="MATCH",
                proposal=run.proposal_json,
                interrupt_id=run.interrupt_id,
            )
        with pytest.raises(RunConflict, match="failed run is terminal"):
            await app.state.repository.complete_without_action(
                run_id=run.run_id,
                subject_ref=config.subject_ref,
                decision="REJECT",
                result={"outcome": "NO_ACTION"},
            )
        with pytest.raises(RunConflict, match="failed run is terminal"):
            await app.state.repository.finalize_approval(
                run_id=run.run_id,
                subject_ref=config.subject_ref,
                lease_token=None,
                proposal_id=run.proposal_id,
                interrupt_id=run.interrupt_id,
                preview_hash=run.preview_hash,
                decision_request_id=str(uuid4()),
                decision="APPROVE",
                reason="must not revive failed run",
            )

    @staticmethod
    async def _delete_thread_checkpoint(app, run_id: str, config) -> None:
        run = await app.state.repository.get_run(run_id, config.subject_ref)
        for table in ("writes", "checkpoints"):
            await app.state.checkpointer.conn.execute(
                f"DELETE FROM {table} WHERE thread_id = ?", (run.thread_id,)
            )
        await app.state.checkpointer.conn.commit()

    @staticmethod
    async def _corrupt_existing_action_preview(app, subject_ref: str) -> None:
        async with app.state.repository._sessions.begin() as session:
            await session.execute(
                update(AgentAction)
                .where(AgentAction.subject_ref == subject_ref)
                .values(preview_hash="0" * 64)
            )

    def test_concurrent_approval_creates_at_most_one_action(self, tmp_path: Path) -> None:
        config = self.config(tmp_path)
        config = config.model_copy(update={"resume_lease_seconds": 1})
        app = create_app(config)
        with TestClient(app) as client:
            waiting = client.post(
                "/api/v1/runs", json=self.create_payload(), headers=self.headers()
            ).json()
            approval = self.resume_payload(waiting)
            app.state.agent_service._graph = SlowInvokeGraph(
                app.state.agent_service._graph, delay=1.5
            )

            def approve():
                return client.post(
                    f"/api/v1/runs/{waiting['run_id']}/resume",
                    json=approval,
                    headers=self.headers(),
                ).status_code

            with ThreadPoolExecutor(max_workers=2) as executor:
                statuses = list(executor.map(lambda _: approve(), range(2)))

        assert set(statuses) <= {200, 409}
        assert 200 in statuses
        assert self.db_scalar(
            select(func.count()).select_from(AgentAction).where(
                AgentAction.subject_ref == config.subject_ref
            )
        ) == 1
