"""Synthetic career rows in the explicit CI schema; no production/copy access."""

import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from _mysql_scripts import split_mysql_script
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from test_automation import INTERNAL, response, worker

from job_helper_api.config import Settings
from job_helper_api.database import Database, now_ms
from job_helper_api.main import create_app
from job_helper_api.migrate import migrate

URL = os.getenv("API_TEST_DATABASE_URL")


@pytest.mark.skipif(
    not URL or os.getenv("API_TEST_ALLOW_SCHEMA_SETUP") != "true",
    reason="Dedicated API CI database was not explicitly enabled",
)
def test_mysql_long_resume_review_restart_delete_and_idempotent_migration():
    assert make_url(URL).database == "ai_job_api_ci"
    uid = 400_000_000 + uuid4().int % 100_000_000
    account = "career-" + str(uid)
    cfg = Settings(
        database_url=URL,
        signing_key="synthetic-signing-" * 4,
        owner_user_id=uid,
        model_key="synthetic-model",
        read_only=False,
        automation_enabled=True,
        career_enabled=True,
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
            await migrate(cfg, apply=True)
            assert await migrate(cfg, apply=False) == []
        finally:
            await db.close()

    asyncio.run(setup())
    transport = httpx.MockTransport(lambda request: httpx.Response(503))
    content = "合成中文  履历事实。\n" * 3000
    # Match Linux's selector loop and avoid asyncmy's Windows Proactor buffer-resize race.
    options = {"loop_factory": asyncio.SelectorEventLoop}
    with TestClient(create_app(cfg, transport), backend_options=options) as client:
        client.headers["Authorization"] = response(
            client.post("/api/user/silently/login", params={"uniqueId": account})
        )
        version = response(
            client.post(
                "/api/job/career/resumes/versions",
                json={
                    "requestId": "mysql-resume",
                    "content": content,
                    "facts": [],
                    "source": "USER_TEXT",
                    "parentVersionId": None,
                },
            )
        )
        job = response(
            client.post(
                "/api/job/career/reviews",
                json={
                    "requestId": "mysql-review",
                    "windowDays": 14,
                    "cutoff": now_ms(),
                    "resumeVersionId": version["versionId"],
                    "objective": "合成岗位",
                    "budget": 2,
                    "hardConstraints": {},
                },
            )
        )
        root, body, _ = worker(client, job)
        response(client.post(root + "/commit", headers=INTERNAL, json=body))
        response(
            client.post(
                root + "/park",
                headers=INTERNAL,
                json={**body, "interruptId": "mysql-interrupt", "waitFor": "CONFIRMATION"},
            )
        )

    with TestClient(create_app(cfg, transport), backend_options=options) as restarted:
        restarted.headers["Authorization"] = response(
            restarted.post("/api/user/silently/login", params={"uniqueId": account})
        )
        assert (
            response(restarted.get("/api/job/career/resumes/versions/" + version["versionId"]))[
                "content"
            ]
            == content
        )
        review = response(restarted.get("/api/job/career/reviews/" + job["jobId"]))
        assert review["job"]["status"] == "WAITING_CONFIRMATION"
        assert review["review"]["analysisSource"] == "RULES_ONLY"
        assert len(review["review"]["resumeProposals"]) == 1
        response(restarted.delete("/api/job/career/reviews/" + job["jobId"]))
        lease = response(
            restarted.post(
                "/internal/automation/cleanup/claim",
                headers=INTERNAL,
                json={"workerId": "mysql-worker"},
            )
        )
        assert lease["jobId"] == job["jobId"]
        response(
            restarted.post(
                "/internal/automation/cleanup/" + lease["cleanupId"] + "/complete",
                headers=INTERNAL,
                json={
                    "jobId": job["jobId"],
                    "leaseToken": lease["leaseToken"],
                    "checkpointDeleted": True,
                },
            )
        )
        view = response(restarted.get("/api/job/career/reviews/" + job["jobId"]))
        assert view["checkpointDeleted"] and "履历" not in json.dumps(view, ensure_ascii=False)
