"""Opt-in integration, restricted to the disposable ai_job_api_ci schema."""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest
from _mysql_scripts import split_mysql_script
from sqlalchemy import inspect, select, text
from sqlalchemy.engine import make_url
from test_outcomes import TOKEN, observation

from job_helper_api.config import Settings
from job_helper_api.database import Database
from job_helper_api.migrate import migrate
from job_helper_api.outcomes.contracts import (
    Analyze,
    Artifact,
    Claim,
    Complete,
    Feedback,
    ObservationBatch,
    Park,
)
from job_helper_api.outcomes.workflow import OutcomeWorkflow

DB_URL = os.getenv("API_TEST_DATABASE_URL")


@pytest.mark.skipif(
    not DB_URL or os.getenv("API_TEST_ALLOW_SCHEMA_SETUP") != "true",
    reason="Dedicated MySQL fixture explicitly required",
)
def test_mysql_outcome_claim_cas_recovery_and_exact_owner_facts():
    assert make_url(DB_URL).database == "ai_job_api_ci"
    owner = 200_000_000 + uuid4().int % 100_000_000
    settings = Settings(
        database_url=DB_URL,
        signing_key="fixture-signing-key-" * 3,
        owner_user_id=owner,
        read_only=False,
        model_key="mock-model-key",
        outcome_enabled=True,
        outcome_internal_token=TOKEN,
    )

    class Model:
        calls = 0

        async def complete(self, *args, **kwargs):
            self.calls += 1
            await asyncio.sleep(0.05)
            return '{"findings":[]}'

    async def run():
        db = Database(DB_URL)
        second = Database(DB_URL)
        model = Model()
        try:
            async with db.engine.begin() as connection:
                schema = (Path(__file__).parents[1] / "schema.sql").read_text(encoding="utf-8-sig")
                for statement in split_mysql_script(schema):
                    await connection.exec_driver_sql(statement)
                names = await connection.run_sync(lambda c: inspect(c).get_table_names())
                assert len([name for name in names if name.startswith("outcome_")]) == 5
                await connection.execute(
                    text(
                        "INSERT INTO user_info(id,unique_id,is_active,preference,ai_seat_status) VALUES (:uid,:key,1,'{}',0)"
                    ),
                    {"uid": owner, "key": "outcome-fixture-" + str(owner)},
                )
            await migrate(settings, apply=True)
            await db.open()
            await second.open()
            first = OutcomeWorkflow(db, settings, model)
            other = OutcomeWorkflow(second, settings, model)
            item = observation(
                "岗位已经招满了。" + "中文补充资料" * 400, job="JobCase" + str(owner)
            )
            batch = ObservationBatch(schemaVersion=1, observations=[item])
            accepted = await first.ingest(owner, batch)
            case_id = accepted["cases"][0]["caseId"]
            claims = await asyncio.gather(
                first.claim(Claim(workerId="a")), other.claim(Claim(workerId="b"))
            )
            assert sum(j is not None for j in claims) == 1
            job = next(j for j in claims if j)
            base = {k: job[k] for k in ("revision", "inputHash", "leaseToken")}
            analyses = await asyncio.gather(
                *[
                    svc.analyze(job["jobId"], Analyze(**base, analysisKind="REJECTION_CAUSES"))
                    for svc in (first, other)
                ]
            )
            assert model.calls == 1 and analyses[0]["artifactId"] == analyses[1]["artifactId"]
            artifact_id = analyses[0]["artifactId"]
            args = Artifact(**base, artifactId=artifact_id)
            assert (await first.validate(job["jobId"], args))["valid"]
            saved = await first.commit(job["jobId"], args)
            await db.close()
            await second.close()
            await db.open()
            async with db.engine.begin() as connection:
                await connection.execute(
                    text("UPDATE outcome_job SET lease_until=1 WHERE id=:job"),
                    {"job": job["jobId"]},
                )
            resumed = await first.claim(Claim(workerId="restarted"))
            base = {k: resumed[k] for k in ("revision", "inputHash", "leaseToken")}
            assert resumed["reportId"] == saved["reportId"]
            assert (
                await first.analyze(job["jobId"], Analyze(**base, analysisKind="REJECTION_CAUSES"))
            )["reused"]
            args = Artifact(**base, artifactId=artifact_id)
            await first.validate(job["jobId"], args)
            assert (await first.commit(job["jobId"], args))["reportId"] == saved["reportId"]
            await first.park(
                job["jobId"],
                Park(**base, artifactId=artifact_id, interruptId="real-checkpoint-test-id"),
            )
            await first.feedback(
                owner,
                saved["reportId"],
                Feedback(requestId="feedback-" + str(owner), action="CONFIRM"),
            )
            confirmed = await first.claim(Claim(workerId="human-resume"))
            base = {k: confirmed[k] for k in ("revision", "inputHash", "leaseToken")}
            assert (
                await first.complete(
                    job["jobId"],
                    Complete(
                        **base,
                        artifactId=artifact_id,
                        feedbackId=confirmed["humanFeedback"]["feedbackId"],
                    ),
                )
            )["status"] == "COMPLETED"
            detail = await first.detail(owner, case_id)
            assert detail["report"]["feedbackStatus"] == "CONFIRMED"
            assert detail["report"]["evidence"][0]["quote"] == item["messages"][0]["text"]
            assert detail["report"]["evidence"][0]["messageId"] == item["messages"][0]["messageId"]
            assert (await first.ingest(owner, batch))["duplicateEventIds"] == [item["eventId"]]
            lower = ObservationBatch(
                schemaVersion=1,
                observations=[
                    {
                        **item,
                        "eventId": item["eventId"].upper(),
                        "encryptJobId": item["encryptJobId"].lower(),
                    }
                ],
            )
            assert (await first.ingest(owner, lower))["cases"][0]["caseId"] != case_id
            table = db.table("outcome_report")
            rows = await db.rows(select(table).where(table.c.user_id == owner))
            assert len(rows) == 1 and model.calls == 1
            assert (await first.listing(owner + 1))["total"] == 0
        finally:
            await db.close()
            await second.close()

    asyncio.run(run())
