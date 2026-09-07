import asyncio
import sqlite3
from dataclasses import replace

import pytest

from job_helper_api.database import Database
from job_helper_api.migrate import migrate
from job_helper_api.outcomes.schema import TABLES


def test_migration_creates_five_tables_explicitly_without_changing_existing_business_rows(world):
    async def run():
        with sqlite3.connect(world["path"]) as connection:
            connection.execute("UPDATE user_info SET ai_seat_status=0 WHERE id=3")
            before = connection.execute("SELECT * FROM user_info").fetchall()
            resume = connection.execute("SELECT * FROM user_resume").fetchall()
            for table in TABLES:
                connection.execute(f"DROP TABLE {table}")
        plan = await migrate(world["settings"], apply=False)
        assert {"create " + table for table in TABLES} <= set(plan)
        db = Database(world["settings"].database_url)
        try:
            assert await db.health() is False
            with sqlite3.connect(world["path"]) as connection:
                assert connection.execute(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'outcome_%'"
                ).fetchone() == (0,)
            await migrate(world["settings"], apply=True)
            assert await db.health() is True
            assert await migrate(world["settings"], apply=False) == []
            with sqlite3.connect(world["path"]) as connection:
                assert connection.execute("SELECT * FROM user_info").fetchall() == before
                assert connection.execute("SELECT * FROM user_resume").fetchall() == resume
        finally:
            await db.close()

    asyncio.run(run())


@pytest.mark.parametrize(
    "changes",
    [
        {"outcome_enabled": True, "outcome_internal_token": "short"},
        {"outcome_read_wait_hours": 0},
        {"outcome_unread_wait_hours": 721},
        {"outcome_lease_seconds": 29},
        {"outcome_lease_seconds": 601},
    ],
)
def test_outcome_configuration_rejects_insecure_or_unbounded_settings(world, changes):
    with pytest.raises(ValueError):
        replace(world["settings"], **changes)
