import asyncio
import json
import sqlite3

import pytest

from job_helper_api import migrate as migration
from job_helper_api.errors import ApiError
from job_helper_api.users import save_resume


def test_first_migration_requires_paused_replies(world, monkeypatch):
    monkeypatch.setattr(migration, "load_settings", lambda: world["settings"])
    with pytest.raises(RuntimeError, match="Pause AI replies"):
        asyncio.run(migration.migrate())
    with sqlite3.connect(world["path"]) as c:
        assert c.execute("SELECT ai_seat_status FROM user_info WHERE id=3").fetchone()[0] == 1
        assert c.execute("SELECT COUNT(*) FROM user_resume").fetchone()[0] == 1


def test_old_chat_pause_seed_is_one_time_and_non_destructive(world, monkeypatch):
    with sqlite3.connect(world["path"]) as c:
        c.execute("UPDATE user_info SET ai_seat_status=0 WHERE id=3")
        c.execute(
            "INSERT INTO msg_session(user_id,session_key,msg_context,status,is_active) VALUES (3,'OldJob:peer','[]',1,1)"
        )
    monkeypatch.setattr(migration, "load_settings", lambda: world["settings"])
    asyncio.run(migration.migrate())
    with sqlite3.connect(world["path"]) as c:
        assert (
            json.loads(
                c.execute(
                    "SELECT value_json FROM py_api_control WHERE user_id=3 AND control_key='stop:OldJob:peer'"
                ).fetchone()[0]
            )
            is True
        )
        c.execute(
            "UPDATE py_api_control SET value_json='false' WHERE control_key='stop:OldJob:peer'"
        )
        c.execute("UPDATE user_info SET ai_seat_status=1 WHERE id=3")
    asyncio.run(migration.migrate())
    with sqlite3.connect(world["path"]) as c:
        assert (
            json.loads(
                c.execute(
                    "SELECT value_json FROM py_api_control WHERE control_key='stop:OldJob:peer'"
                ).fetchone()[0]
            )
            is False
        )
        assert c.execute("SELECT COUNT(*) FROM msg_session").fetchone()[0] == 1
        assert c.execute("SELECT COUNT(*) FROM user_resume").fetchone()[0] == 1


def test_utf8_resume_limit_is_checked_before_any_database_write():
    with pytest.raises(ApiError, match="安全长度"):
        asyncio.run(save_resume(None, 3, "测" * 21000, "too-long"))


def test_migration_plan_does_not_write_or_require_pausing_to_inspect(world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("DROP TABLE py_api_control")
        connection.execute("DROP TABLE py_api_request")
    plan = asyncio.run(migration.migrate(world["settings"], apply=False))
    assert "create py_api_control" in plan
    assert any("pause AI replies" in item for item in plan)
    with sqlite3.connect(world["path"]) as connection:
        names = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "py_api_control" not in names
        assert (
            connection.execute("SELECT ai_seat_status FROM user_info WHERE id=3").fetchone()[0] == 1
        )


def test_migration_creates_missing_rejection_tables_without_touching_other_accounts(world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE user_info SET ai_seat_status=0 WHERE id=3")
        connection.execute("DROP TABLE job_application_snapshot")
        connection.execute("DROP TABLE rejection_analysis")
    plan = asyncio.run(migration.migrate(world["settings"], apply=True))
    assert "create rejection_analysis" in plan
    with sqlite3.connect(world["path"]) as connection:
        assert (
            connection.execute("SELECT ai_seat_status FROM user_info WHERE id=9").fetchone()[0] == 1
        )
        assert connection.execute("SELECT COUNT(*) FROM user_resume").fetchone()[0] == 1
        columns = {
            row[1]: row for row in connection.execute("PRAGMA table_info(rejection_analysis)")
        }
        assert columns["application_snapshot_id"][3] == 0
    assert asyncio.run(migration.migrate(world["settings"], apply=False)) == []


def test_explicit_release_pause_only_changes_bound_owner_and_stays_paused(world):
    previous = asyncio.run(migration.pause_owner(world["settings"]))
    assert previous == 1
    asyncio.run(migration.migrate(world["settings"], apply=True))
    with sqlite3.connect(world["path"]) as connection:
        assert (
            connection.execute("SELECT ai_seat_status FROM user_info WHERE id=3").fetchone()[0] == 0
        )
        assert (
            connection.execute("SELECT ai_seat_status FROM user_info WHERE id=9").fetchone()[0] == 1
        )


def test_pause_flag_cannot_be_used_in_plan_mode():
    with pytest.raises(ValueError, match="requires --apply"):
        asyncio.run(migration.run_cli(apply=False, pause=True))
