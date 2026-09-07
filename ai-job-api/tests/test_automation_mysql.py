"""Opt-in synthetic owners in the explicit API CI database. Never a production copy."""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from _mysql_scripts import split_mysql_script
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from test_automation import BASE, INTERNAL, reply_input, response, worker

from job_helper_api.config import Settings
from job_helper_api.database import Database
from job_helper_api.main import create_app
from job_helper_api.migrate import migrate

URL = os.getenv("API_TEST_DATABASE_URL")


@pytest.mark.skipif(
    not URL or os.getenv("API_TEST_ALLOW_SCHEMA_SETUP") != "true",
    reason="Dedicated API CI database was not explicitly enabled",
)
def test_mysql_graph_ack_restart_and_terminal_reconcile():
    assert make_url(URL).database == "ai_job_api_ci"
    uid = 200_000_000 + uuid4().int % 100_000_000
    account = "graph-" + str(uid)
    settings = Settings(
        database_url=URL,
        signing_key="test-signing-" * 4,
        owner_user_id=uid,
        model_key="synthetic-model",
        read_only=False,
        automation_enabled=True,
        outcome_internal_token=INTERNAL["X-Internal-Token"],
    )

    async def setup():
        db = Database(URL)
        try:
            async with db.engine.begin() as c:
                for statement in split_mysql_script(
                    (Path(__file__).parents[1] / "schema.sql").read_text(encoding="utf-8-sig")
                ):
                    await c.exec_driver_sql(statement)
                await c.execute(
                    text(
                        "INSERT INTO user_info(id,unique_id,is_active,ai_seat_status,preference) VALUES(:uid,:account,1,0,'{}')"
                    ),
                    {"uid": uid, "account": account},
                )
                await c.execute(
                    text(
                        "INSERT INTO user_resume(user_id,resume_content,is_active) VALUES(:uid,:resume,1)"
                    ),
                    {"uid": uid, "resume": "合成中文履历。" * 3000},
                )
            await migrate(settings, apply=True)
            async with db.engine.begin() as c:
                await c.execute(
                    text("UPDATE user_info SET ai_seat_status=1 WHERE id=:uid"), {"uid": uid}
                )
        finally:
            await db.close()

    asyncio.run(setup())
    calls = []

    def model(request):
        calls.append(request)
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "您好，这是合成测试回复。"}}]}
        )

    transport = httpx.MockTransport(model)
    with TestClient(create_app(settings, transport)) as client:
        client.headers["Authorization"] = response(
            client.post("/api/user/silently/login", params={"uniqueId": account})
        )
        raw = reply_input(platformAccount=account)
        raw["input"]["jobKey"] = "JobCase:" + account
        job = response(client.post(BASE + "/jobs", json=raw))
        root, body, _ = worker(client, job)
        scope = {"executorId": "mysql-executor", "platformAccount": account}
        response(
            client.post(
                BASE + "/executors/heartbeat",
                json={
                    **scope,
                    "capabilities": ["SEND_TEXT"],
                    "replyEnabled": True,
                    "deliveryEnabled": False,
                },
            )
        )
        action = response(
            client.post(BASE + "/actions/claim", json={**scope, "jobId": job["jobId"]})
        )
        dispatched = response(
            client.post(
                BASE + "/actions/" + action["actionId"] + "/dispatch",
                json={
                    **scope,
                    "leaseToken": action["leaseToken"],
                    "authorizationRevision": action["authorizationRevision"],
                    "clientMid": "12345",
                },
            )
        )
        receipt = {
            **scope,
            "requestId": "mysql-ack",
            "dispatchToken": dispatched["dispatchToken"],
            "clientMid": "12345",
            "serverMid": "67890",
            "status": "ACKNOWLEDGED",
            "platformCode": 0,
            "occurredAt": raw["input"]["inboundSentAt"],
        }
        response(client.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
        response(client.post(BASE + "/actions/" + action["actionId"] + "/receipt", json=receipt))
        assert (
            response(client.post(root + "/complete", json=body, headers=INTERNAL))["status"]
            == "COMPLETED"
        )

    async def expire_and_assert():
        db = Database(URL)
        try:
            async with db.engine.begin() as c:
                assert (
                    await c.scalar(
                        text("SELECT COUNT(*) FROM msg_session WHERE user_id=:uid"), {"uid": uid}
                    )
                    == 1
                )
                assert (
                    await c.scalar(
                        text("SELECT COUNT(*) FROM automation_action WHERE user_id=:uid"),
                        {"uid": uid},
                    )
                    == 1
                )
                await c.execute(
                    text("UPDATE automation_job SET lease_until=1 WHERE user_id=:uid"), {"uid": uid}
                )
        finally:
            await db.close()

    asyncio.run(expire_and_assert())
    with TestClient(create_app(settings, transport)) as restarted:
        restarted.headers["Authorization"] = response(
            restarted.post("/api/user/silently/login", params={"uniqueId": account})
        )
        assert response(restarted.get(BASE + "/jobs/" + job["jobId"]))["status"] == "COMPLETED"
        claim = response(
            restarted.post(
                "/internal/automation/claim", json={"workerId": "restarted"}, headers=INTERNAL
            )
        )
        assert claim["executionMode"] == "RECONCILE_TERMINAL"
        final = {**body, "leaseToken": claim["leaseToken"]}
        response(restarted.post(root + "/complete", json=final, headers=INTERNAL))
        assert response(restarted.post(root + "/graph-complete", json=final, headers=INTERNAL))[
            "graphFinalized"
        ]
        assert (
            response(
                restarted.post(
                    "/internal/automation/claim", json={"workerId": "restarted"}, headers=INTERNAL
                )
            )
            is None
        )
    assert len(calls) == 1
