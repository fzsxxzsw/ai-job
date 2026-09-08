"""Idempotently project saved outcome reports into career progress events."""

import asyncio
import json
from types import SimpleNamespace

from sqlalchemy import func, select

from ..config import load_settings
from ..database import Database
from .applications import Applications
from .legacy_sessions import import_legacy_sessions
from .observations import record_outcome_report


async def reconcile_saved_outcomes() -> dict[str, int]:
    settings = load_settings()
    database = Database(settings.database_url)
    try:
        if not await database.health():
            raise RuntimeError("database is not ready")
        if not settings.career_enabled:
            return {"reportsProcessed": 0, "contactsAdded": 0, "eventsAdded": 0}

        uid = settings.owner_user_id
        cases = database.table("outcome_case")
        reports = database.table("outcome_report")
        events = database.table("career_application_event")
        service = SimpleNamespace(db=database, settings=settings)
        store = Applications(database, settings)

        async with database.lock(uid, "outcomes:state"):
            async with database.engine.begin() as connection:
                if not await database.user(uid, connection):
                    raise RuntimeError("owner user is not active")
                before = await connection.scalar(
                    select(func.count()).select_from(events).where(events.c.user_id == uid)
                )
                snapshots = database.table("job_application_snapshot")
                applications = database.table("career_application")
                legacy_rows = (
                    (
                        await connection.execute(
                            select(applications, snapshots)
                            .join(
                                snapshots,
                                (snapshots.c.user_id == applications.c.user_id)
                                & (snapshots.c.id == applications.c.legacy_snapshot_id),
                            )
                            .where(applications.c.user_id == uid)
                            .order_by(snapshots.c.applied_at.asc(), snapshots.c.id.asc())
                        )
                    )
                    .mappings()
                    .all()
                )
                contacts_added = 0
                for joined in legacy_rows:
                    app = {
                        column.name: joined[applications.c[column.name]]
                        for column in applications.c
                    }
                    snapshot = {
                        column.name: joined[snapshots.c[column.name]] for column in snapshots.c
                    }
                    if await store.ensure_legacy_contact(connection, uid, app, snapshot):
                        contacts_added += 1
                session_counts = await import_legacy_sessions(connection, uid, store)
                saved_cases = (
                    await connection.execute(
                        select(cases)
                        .where(cases.c.user_id == uid, cases.c.current_report_id.is_not(None))
                        .order_by(cases.c.updated_at.asc(), cases.c.id.asc())
                    )
                ).mappings()
                processed = 0
                for saved_case in saved_cases:
                    case = dict(saved_case)
                    report = await database.one(
                        select(reports).where(
                            reports.c.user_id == uid,
                            reports.c.id == case["current_report_id"],
                        ),
                        connection,
                    )
                    if not report:
                        continue
                    await record_outcome_report(service, connection, uid, case, report)
                    processed += 1
                after = await connection.scalar(
                    select(func.count()).select_from(events).where(events.c.user_id == uid)
                )
        return {
            "reportsProcessed": processed,
            "contactsAdded": contacts_added,
            "eventsAdded": int(after or 0) - int(before or 0),
            **session_counts,
        }
    finally:
        await database.close()


def main() -> None:
    print(json.dumps(asyncio.run(reconcile_saved_outcomes()), ensure_ascii=False))


if __name__ == "__main__":
    main()
