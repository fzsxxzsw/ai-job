"""Explicit, idempotent Python cutover. CLI defaults to a read-only plan."""

import argparse
import asyncio

from sqlalchemy import MetaData, Table, inspect, select, text
from sqlalchemy.dialects.mysql import LONGTEXT

from .automation.schema import automation_metadata
from .career.schema import career_metadata
from .config import Settings, load_settings
from .database import LEGACY_TABLES, OWN_TABLES, Database, loads, now_date, own_metadata
from .outcomes.schema import outcome_metadata
from .schema import rejection_metadata

PAUSE_MARKER = "migration:legacy-session-pauses-v1"
LONG_TEXT_COLUMNS = {
    "job_application_snapshot": (
        "job_base_info",
        "job_ext_info",
        "resume_content",
        "preference_snapshot",
        "pre_match_result",
    ),
    "rejection_analysis": ("conversation_json", "analysis_json"),
}
BINARY_KEY_COLUMNS = {
    "delivery_audit": ("audit_id",),
    "job_application_snapshot": ("encrypt_job_id",),
    "py_api_control": ("control_key",),
    "py_api_request": ("session_key",),
}


async def migrate(settings: Settings | None = None, *, apply: bool = True) -> list[str]:
    """The callable retains the old explicit-apply behavior for deployment scripts."""
    config = settings or load_settings()
    db = Database(config.database_url)
    try:
        async with db.engine.connect() as connection:
            names = await connection.run_sync(lambda c: set(inspect(c).get_table_names()))
            optional = set(rejection_metadata().tables)
            missing_core = set(LEGACY_TABLES) - optional - names
            if missing_core:
                raise RuntimeError(
                    "Legacy schema is missing tables: " + ", ".join(sorted(missing_core))
                )
            user = await connection.run_sync(
                lambda c: Table("user_info", MetaData(), autoload_with=c)
            )
            owner = (
                (
                    await connection.execute(
                        select(user).where(
                            user.c.id == config.owner_user_id, user.c.is_active.is_(True)
                        )
                    )
                )
                .mappings()
                .first()
            )
            if not owner:
                raise RuntimeError("The configured Python owner does not exist or is inactive")
            seeded = False
            if "py_api_control" in names:
                marker = await connection.scalar(
                    text(
                        "SELECT value_json FROM py_api_control WHERE user_id=:uid AND control_key=:key"
                    ),
                    {"uid": config.owner_user_id, "key": PAUSE_MARKER},
                )
                seeded = loads(marker, False) is True
            plan = [
                "create " + name for name in (*OWN_TABLES, *sorted(optional)) if name not in names
            ]
            alterations: list[str] = []
            if "automation_job" in names:
                automation_columns = await connection.run_sync(
                    lambda c: {col["name"] for col in inspect(c).get_columns("automation_job")}
                )
                if "graph_finalized" not in automation_columns:
                    alterations.append(
                        "ALTER TABLE automation_job ADD COLUMN graph_finalized INTEGER NOT NULL DEFAULT 1"
                    )
            for table_name in sorted(LONG_TEXT_COLUMNS.keys() | BINARY_KEY_COLUMNS.keys()):
                long_columns = LONG_TEXT_COLUMNS.get(table_name, ())
                if table_name not in names:
                    continue
                columns = await connection.run_sync(
                    lambda c, name=table_name: inspect(c).get_columns(name)
                )
                for column in columns:
                    if (
                        db.engine.dialect.name == "mysql"
                        and column["name"] in BINARY_KEY_COLUMNS.get(table_name, ())
                        and getattr(column["type"], "collation", None) != "utf8mb4_bin"
                    ):
                        length = column["type"].length
                        nullability = "NULL" if column["nullable"] else "NOT NULL"
                        alterations.append(
                            f"ALTER TABLE `{table_name}` MODIFY COLUMN `{column['name']}` "
                            f"VARCHAR({length}) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin {nullability}"
                        )
                    if (
                        table_name == "rejection_analysis"
                        and column["name"] == "application_snapshot_id"
                        and not column["nullable"]
                    ):
                        if db.engine.dialect.name != "mysql":
                            raise RuntimeError("Legacy nullable-column migration requires MySQL")
                        alterations.append(
                            "ALTER TABLE rejection_analysis MODIFY COLUMN application_snapshot_id BIGINT NULL"
                        )
                    if (
                        db.engine.dialect.name == "mysql"
                        and column["name"] in long_columns
                        and not isinstance(column["type"], LONGTEXT)
                    ):
                        nullability = "NULL" if column["nullable"] else "NOT NULL"
                        alterations.append(
                            f"ALTER TABLE `{table_name}` MODIFY COLUMN `{column['name']}` LONGTEXT {nullability}"
                        )
            plan.extend(alterations)
            if not seeded:
                plan.append("preserve legacy chats and pause their Python reply controls")
                if owner["ai_seat_status"] == 1:
                    plan.append("REQUIRED: pause AI replies for the bound owner before applying")
                    if apply:
                        raise RuntimeError(
                            "Pause AI replies for the bound owner before the first Python cutover"
                        )
        if not apply:
            return plan

        # MySQL DDL commits implicitly. Check preconditions before any mutation;
        # each operation below can be repeated after an interrupted migration.
        async with db.engine.begin() as connection:
            await connection.run_sync(rejection_metadata().create_all)
            await connection.run_sync(own_metadata().create_all)
            await connection.run_sync(outcome_metadata().create_all)
            await connection.run_sync(automation_metadata().create_all)
            await connection.run_sync(career_metadata().create_all)
            for statement in alterations:
                await connection.execute(text(statement))
        await db.open()
        async with db.lock(config.owner_user_id, "migration:cutover"):
            async with db.engine.begin() as connection:
                if not await db.control(config.owner_user_id, PAUSE_MARKER, False, connection):
                    sessions = db.table("msg_session")
                    keys = (
                        (
                            await connection.execute(
                                select(sessions.c.session_key).where(
                                    sessions.c.user_id == config.owner_user_id,
                                    sessions.c.is_active.is_(True),
                                )
                            )
                        )
                        .scalars()
                        .all()
                    )
                    for key in sorted(set(key for key in keys if key)):
                        await db.set_control(connection, config.owner_user_id, "stop:" + key, True)
                    await db.set_control(connection, config.owner_user_id, PAUSE_MARKER, True)
        return plan
    finally:
        await db.close()


async def pause_owner(settings: Settings) -> int | None:
    """Explicit release-only pause; callers must take their backup first.

    Deliberately separate from migrate(): planning, startup and ordinary migration
    never silently change the owner's automation state. Rollback stays paused.
    """
    db = Database(settings.database_url)
    try:
        async with db.engine.begin() as connection:
            user = await connection.run_sync(
                lambda c: Table("user_info", MetaData(), autoload_with=c)
            )
            condition = (user.c.id == settings.owner_user_id) & user.c.is_active.is_(True)
            owner = (
                (await connection.execute(select(user).where(condition).with_for_update()))
                .mappings()
                .first()
            )
            if not owner:
                raise RuntimeError("The configured Python owner does not exist or is inactive")
            previous = owner["ai_seat_status"]
            await connection.execute(
                user.update()
                .where(condition)
                .values(
                    ai_seat_status=0, updated_id=settings.owner_user_id, updated_date=now_date()
                )
            )
        return previous
    finally:
        await db.close()


async def run_cli(*, apply: bool, pause: bool) -> list[str]:
    if pause and not apply:
        raise ValueError("--pause-owner requires --apply")
    settings = load_settings()
    if pause:
        previous = await pause_owner(settings)
        print(
            f"OWNER_REPLY_PAUSED userId={settings.owner_user_id} previousStatus={previous}; rollback stays paused"
        )
    return await migrate(settings, apply=apply)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Apply after backup and after pausing AI replies"
    )
    parser.add_argument(
        "--pause-owner",
        action="store_true",
        help="After backup, pause the bound owner before applying",
    )
    args = parser.parse_args()
    if args.pause_owner and not args.apply:
        parser.error("--pause-owner requires --apply")
    result = asyncio.run(run_cli(apply=args.apply, pause=args.pause_owner))
    print(
        ("APPLIED: " if args.apply else "PLAN ONLY: ") + "; ".join(result or ["already compatible"])
    )
