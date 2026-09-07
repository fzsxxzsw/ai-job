"""Opt-in MySQL regression on a dedicated fixture database, never a data copy.

Requires both API_TEST_DATABASE_URL targeting exactly ai_job_api_ci and
API_TEST_ALLOW_SCHEMA_SETUP=true. No tables or existing rows are deleted. Only
an initially empty database is changed to simulate pre-migration column types.
"""

import asyncio
import os
from pathlib import Path
from uuid import uuid4

import pytest
from _mysql_scripts import split_mysql_script
from sqlalchemy import inspect, select, text
from sqlalchemy.engine import make_url

from job_helper_api.config import Settings
from job_helper_api.contracts import FeedbackInput, RejectionInput, SnapshotInput
from job_helper_api.database import Database, now_ms
from job_helper_api.errors import ApiError
from job_helper_api.migrate import migrate
from job_helper_api.rejection_engine.service import analyze, feedback, get_report, save_snapshot

DB_URL = os.getenv("API_TEST_DATABASE_URL")
ALLOWED_SETUP = os.getenv("API_TEST_ALLOW_SCHEMA_SETUP") == "true"


@pytest.mark.skipif(
    not DB_URL or not ALLOWED_SETUP,
    reason="Dedicated MySQL fixture database not explicitly enabled",
)
def test_mysql_migration_storage_concurrency_and_restart():
    assert make_url(DB_URL).database == "ai_job_api_ci", (
        "Refusing a database other than the dedicated API CI fixture"
    )
    owner = 1_000_000 + uuid4().int % 100_000_000
    settings = Settings(
        database_url=DB_URL,
        signing_key="fixture-signing-key-" * 3,
        owner_user_id=owner,
        read_only=False,
        model_key="fixture-model-key",
    )

    class FakeModel:
        calls = 0

        async def complete(self, *args, **kwargs):
            self.calls += 1
            await asyncio.sleep(0.05)
            return '{"findings":[]}'

    async def run():
        db = Database(DB_URL)
        model = FakeModel()
        try:
            async with db.engine.begin() as connection:
                names = await connection.run_sync(lambda conn: inspect(conn).get_table_names())
                schema = (Path(__file__).parents[1] / "schema.sql").read_text(encoding="utf-8-sig")
                # This is the project's checked-in schema, never external/user SQL.
                for statement in split_mysql_script(schema):
                    await connection.exec_driver_sql(statement)
                if not names:
                    await connection.execute(
                        text(
                            "ALTER TABLE rejection_analysis MODIFY COLUMN application_snapshot_id BIGINT NOT NULL"
                        )
                    )
                    await connection.execute(
                        text(
                            "ALTER TABLE job_application_snapshot MODIFY COLUMN job_ext_info TEXT NULL"
                        )
                    )
                await connection.execute(
                    text(
                        "INSERT INTO user_info(id,unique_id,is_active,preference,ai_seat_status) VALUES (:id,:key,1,'{}',0)"
                    ),
                    {"id": owner, "key": "fixture-" + str(owner)},
                )
                await connection.execute(
                    text(
                        "INSERT INTO user_info(id,unique_id,is_active,preference,ai_seat_status) VALUES (:id,:key,1,'{}',0)"
                    ),
                    {"id": owner + 1, "key": "fixture-" + str(owner + 1)},
                )
                await connection.execute(
                    text(
                        "INSERT INTO user_resume(user_id,resume_content,is_active) VALUES (:uid,:resume,1)"
                    ),
                    {"uid": owner, "resume": "投递时旧简历：2年Python开发经验"},
                )
            plan = await migrate(settings, apply=False)
            if not names:
                assert any("application_snapshot_id" in step for step in plan)
                assert any("LONGTEXT" in step for step in plan)
            await migrate(settings, apply=True)
            assert await migrate(settings, apply=False) == []
            await db.open()
            assert db.ready
            key = "JobCase-" + str(owner)
            snapshot = SnapshotInput(
                encryptJobId=key,
                appliedAt=now_ms(),
                jobBaseInfo="Python岗位",
                jobExtInfo="岗位描述" * 6000,
                preMatchResult=None,
            )
            first = await save_snapshot(db, owner, snapshot)
            lower = await save_snapshot(
                db, owner, snapshot.model_copy(update={"encryptJobId": key.lower()})
            )
            assert first["id"] != lower["id"]
            table = db.table("job_application_snapshot")
            stored = await db.one(select(table).where(table.c.id == first["id"]))
            assert stored["job_ext_info"] == snapshot.jobExtInfo
            async with db.engine.begin() as connection:
                await connection.execute(
                    text(
                        "UPDATE user_resume SET resume_content='后来修改的新简历' WHERE user_id=:uid"
                    ),
                    {"uid": owner},
                )
            payload = RejectionInput(
                encryptJobId=key,
                conversationKey="peer-" + str(owner),
                messages=[{"role": "HR", "text": "岗位已招满"}],
            )
            # A second Database object proves the MySQL lock, not just the local lock.
            second_db = Database(DB_URL)
            await second_db.open()
            try:
                reports = await asyncio.gather(
                    analyze(db, model, settings, owner, payload),
                    analyze(second_db, model, settings, owner, payload),
                )
            finally:
                await second_db.close()
            assert reports[0]["id"] == reports[1]["id"] and model.calls == 1
            report = reports[0]
            assert any("投递时旧简历" in item["text"] for item in report["evidence"])
            with pytest.raises(ApiError) as failure:
                await get_report(db, owner + 1, report["id"])
            assert failure.value.code == 404
            await feedback(db, owner, report["id"], FeedbackInput(action="CONFIRM"))
            old_chat = await analyze(
                db,
                model,
                settings,
                owner,
                payload.model_copy(update={"encryptJobId": "history-only-" + str(owner)}),
            )
            assert old_chat["applicationSnapshotId"] is None and old_chat["inferredRisks"] == []
            ident = report["id"]
        finally:
            await db.close()
        restarted = Database(DB_URL)
        await restarted.open()
        try:
            assert (await get_report(restarted, owner, ident))["status"] == "CONFIRMED"
        finally:
            await restarted.close()

    asyncio.run(run())
