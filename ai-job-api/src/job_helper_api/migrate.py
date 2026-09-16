"""Explicit, idempotent Python cutover. CLI defaults to a read-only plan."""

import argparse
import asyncio

from sqlalchemy import MetaData, Table, inspect, select, text
from sqlalchemy.dialects.mysql import LONGTEXT

from .application_validity import validity_columns
from .automation.conversation_history import MIGRATION_MARKER, backfill_exact
from .automation.schema import automation_metadata
from .automation.storage import digest, identifier
from .career.applications import STATUS_PRIORITY
from .career.schema import career_metadata
from .config import Settings, load_settings
from .database import (
    LEGACY_TABLES,
    OWN_TABLES,
    Database,
    dumps,
    loads,
    now_date,
    now_ms,
    own_metadata,
)
from .outcomes.schema import outcome_metadata
from .schema import rejection_metadata

PAUSE_MARKER = "migration:legacy-session-pauses-v1"
APPLICATION_LEDGER_MARKER = "migration:application-ledger-v2"
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


def _snapshot_text(value, limit: int) -> str | None:
    text_value = str(value or "").strip()
    return text_value[:limit] or None


def _snapshot_values(row) -> tuple[dict, dict]:
    data = loads(row["data_json"], {})
    if not isinstance(data, dict):
        data = {}
    base = loads(data.get("jobBaseInfo"), {})
    ext = loads(data.get("jobExtInfo"), {})
    base = base if isinstance(base, dict) else {}
    ext = ext if isinstance(ext, dict) else {}
    location = " ".join(
        dict.fromkeys(
            part
            for part in (
                _snapshot_text(base.get("cityName"), 120),
                _snapshot_text(base.get("areaDistrict"), 120),
                _snapshot_text(base.get("businessDistrict"), 120),
                _snapshot_text(ext.get("address"), 300),
            )
            if part
        )
    )
    normalized = {
        "job_title": _snapshot_text(
            data.get("jobTitle") or base.get("jobName") or base.get("jobTitle"), 255
        ),
        "company_name": _snapshot_text(
            data.get("companyName") or base.get("brandName") or base.get("companyName"), 255
        ),
        "recruiter_name": _snapshot_text(data.get("recruiterName"), 255),
        "salary_text": _snapshot_text(
            data.get("salaryText") or base.get("salaryDesc") or base.get("salary"), 255
        ),
        "location_text": _snapshot_text(data.get("locationText") or location, 500),
        "jd_text": _snapshot_text(
            data.get("jdText")
            or ext.get("postDescription")
            or ext.get("jobDescription")
            or ext.get("description"),
            60000,
        ),
    }
    field_names = {
        "job_title": "jobTitle",
        "company_name": "companyName",
        "recruiter_name": "recruiterName",
        "salary_text": "salaryText",
        "location_text": "locationText",
        "jd_text": "jdText",
    }
    for column, field in field_names.items():
        if normalized[column]:
            data[field] = normalized[column]
    missing = [field_names[name] for name, value in normalized.items() if not value]
    data.update(
        snapshotCompleteness="COMPLETE" if not missing else "PARTIAL",
        missingFields=missing,
    )
    return normalized, data


def _migrated_application_values(uid, binding, snapshot, observed_at):
    account, encrypt_job_id, conversation_key, boss_id = binding
    if snapshot:
        origin = "ASSISTANT"
        source = "MIGRATED_APPLICATION_SNAPSHOT"
        data = {
            "jobBaseInfo": snapshot["job_base_info"] or "{}",
            "jobExtInfo": snapshot["job_ext_info"] or "{}",
            "capturedResumeContent": snapshot["resume_content"],
            "capturedPreference": snapshot["preference_snapshot"],
            "preMatchResult": loads(snapshot["pre_match_result"], None),
            "capturedAt": snapshot["applied_at"] or snapshot["created_at"],
            "legacySnapshotId": snapshot["id"],
        }
        contacted_at = snapshot["applied_at"]
        legacy_snapshot_id = snapshot["id"]
        status = "APPLIED"
    else:
        origin = "MANUAL_DISCOVERED"
        source = "MIGRATED_CONVERSATION"
        data = {}
        contacted_at = None
        legacy_snapshot_id = None
        status = "DISCOVERED"
    data.update(
        origin=origin,
        snapshotSources=[{"origin": origin, "source": source, "observedAt": observed_at}],
    )
    normalized, data = _snapshot_values({"data_json": dumps(data)})
    cycle_key = "migration:conversation:" + digest(binding)[:32]
    created_at = (snapshot["created_at"] or snapshot["applied_at"]) if snapshot else observed_at
    return dict(
        id=identifier(),
        user_id=uid,
        application_key=digest([account, encrypt_job_id, cycle_key]),
        platform_account=account,
        encrypt_job_id=encrypt_job_id,
        conversation_key=conversation_key,
        boss_id=boss_id,
        cycle_key=cycle_key,
        job_id=None,
        prepared_resume_version_id=None,
        strategy_plan_id=None,
        contacted_at=contacted_at,
        origin=origin,
        **normalized,
        snapshot_completeness=data["snapshotCompleteness"],
        read_state="UNKNOWN",
        read_state_updated_at=None,
        application_status=status,
        status_updated_at=observed_at,
        status_evidence_json=dumps({"source": source, "asOf": observed_at, "status": status}),
        first_observed_at=observed_at,
        data_json=dumps(data),
        legacy_snapshot_id=legacy_snapshot_id,
        created_at=created_at,
        updated_at=created_at,
    )


def _migrated_projection_status(app, projection):
    outcome = projection.get("outcome", "UNKNOWN")
    read_state = projection.get("readState", "UNKNOWN")
    waiting = projection.get("waitingOn", "UNKNOWN")
    evidence = projection.get("evidence") or []
    quote = " ".join(str(item.get("quote") or "") for item in evidence if isinstance(item, dict))
    if outcome == "REJECTED":
        return "EXPLICIT_REJECTED"
    if outcome == "POSITIVE":
        if any(signal in quote.lower() for signal in ("offer", "录用通知", "决定录用", "办理入职")):
            return "OFFER_RECEIVED"
        if any(signal in quote for signal in ("面试", "笔试", "测评", "到公司", "来公司", "面谈")):
            return "INTERVIEW_SCHEDULED"
        return "HR_REPLIED"
    if outcome == "NO_REPLY" and read_state == "READ":
        return "SOFT_REJECTED"
    if outcome == "REPLIED":
        return "HR_REPLIED"
    if waiting == "HR" and read_state in {"READ", "UNREAD"}:
        return read_state
    return "APPLIED" if app["origin"] in {"ASSISTANT", "LEGACY_IMPORT"} else "DISCOVERED"


async def backfill_application_ledger(db: Database, connection, uid: int) -> dict:
    applications = db.table("career_application")
    application_events = db.table("career_application_event")
    messages = db.table("conversation_message")
    snapshots = db.table("job_application_snapshot")
    outcome_cases = db.table("outcome_case")
    rows = (
        (await connection.execute(select(applications).where(applications.c.user_id == uid)))
        .mappings()
        .all()
    )
    application_rows = [dict(row) for row in rows]
    exact: dict[tuple[str, str, str, str], list[str]] = {}
    for row in application_rows:
        normalized, data = _snapshot_values(row)
        origin = (
            row["origin"]
            if row["origin"] in {"ASSISTANT", "MANUAL_DISCOVERED", "LEGACY_IMPORT"}
            else "LEGACY_IMPORT"
            if row["legacy_snapshot_id"] is not None
            else "ASSISTANT"
            if row["job_id"] is not None or row["contacted_at"] is not None
            else row["origin"] or "UNKNOWN"
        )
        observed_at = row["contacted_at"] or row["created_at"]
        status = row["application_status"] or (
            "APPLIED" if row["contacted_at"] is not None else "DISCOVERED"
        )
        if status == "DISCOVERED" and row["contacted_at"] is not None:
            status = "APPLIED"
        data["origin"] = origin
        await connection.execute(
            applications.update()
            .where(applications.c.id == row["id"], applications.c.user_id == uid)
            .values(
                **normalized,
                origin=origin,
                snapshot_completeness=data["snapshotCompleteness"],
                application_status=status or "DISCOVERED",
                status_updated_at=row["status_updated_at"] or observed_at,
                status_evidence_json=row["status_evidence_json"]
                or dumps({"source": "APPLICATION_LEDGER_MIGRATION", "asOf": observed_at}),
                first_observed_at=row["first_observed_at"] or observed_at,
                data_json=dumps(data),
                updated_at=row["updated_at"] or row["created_at"],
            )
        )
        row.update(
            **normalized,
            origin=origin,
            snapshot_completeness=data["snapshotCompleteness"],
            application_status=status or "DISCOVERED",
            status_updated_at=row["status_updated_at"] or observed_at,
            first_observed_at=row["first_observed_at"] or observed_at,
            data_json=dumps(data),
        )
        binding = (
            row["platform_account"],
            row["encrypt_job_id"],
            row["conversation_key"],
            row["boss_id"],
        )
        if all(binding):
            exact.setdefault(binding, []).append(row["id"])

    snapshot_rows = (
        (await connection.execute(select(snapshots).where(snapshots.c.user_id == uid)))
        .mappings()
        .all()
    )
    snapshot_by_job = {row["encrypt_job_id"]: row for row in snapshot_rows}
    linked = ambiguous = created = bound = status_updated = 0
    message_rows = (
        (
            await connection.execute(
                select(messages).where(
                    messages.c.user_id == uid, messages.c.application_id.is_(None)
                )
            )
        )
        .mappings()
        .all()
    )
    message_groups: dict[tuple[str, str, str, str], list] = {}
    for message in message_rows:
        binding = (
            message["platform_account"],
            message["encrypt_job_id"],
            message["conversation_key"],
            message["boss_id"],
        )
        message_groups.setdefault(binding, []).append(message)
    for binding, group in message_groups.items():
        owners = exact.get(binding, [])
        if not owners:
            account, encrypt_job_id, conversation_key, boss_id = binding
            compatible = [
                app
                for app in application_rows
                if app["encrypt_job_id"] == encrypt_job_id
                and app["platform_account"] in {account, "UNKNOWN"}
                and app["conversation_key"] in {None, "", conversation_key}
                and app["boss_id"] in {None, "", boss_id}
            ]
            if len(compatible) == 1:
                app = compatible[0]
                values = {
                    "conversation_key": conversation_key,
                    "boss_id": boss_id,
                    "updated_at": max(
                        app["updated_at"] or 0, max(row["observed_at"] for row in group)
                    ),
                }
                if app["platform_account"] == "UNKNOWN":
                    values["platform_account"] = account
                await connection.execute(
                    applications.update()
                    .where(applications.c.id == app["id"], applications.c.user_id == uid)
                    .values(**values)
                )
                app.update(**values)
                exact[binding] = owners = [app["id"]]
                bound += 1
            elif len(compatible) > 1:
                ambiguous += len(group)
                continue
            else:
                observed_at = min(row["observed_at"] for row in group)
                app = _migrated_application_values(
                    uid,
                    binding,
                    snapshot_by_job.get(encrypt_job_id),
                    observed_at,
                )
                await connection.execute(applications.insert().values(**app))
                application_rows.append(app)
                exact[binding] = owners = [app["id"]]
                event_type = (
                    "CONTACT_INITIATED"
                    if app["origin"] == "ASSISTANT"
                    else "APPLICATION_DISCOVERED"
                )
                await connection.execute(
                    application_events.insert().values(
                        id=identifier(),
                        user_id=uid,
                        application_id=app["id"],
                        event_type=event_type,
                        occurred_at=observed_at,
                        confirmation="OBSERVED",
                        evidence_json=dumps(
                            {
                                "source": "APPLICATION_LEDGER_MIGRATION",
                                "conversationKey": binding[2],
                                "bossId": binding[3],
                            }
                        ),
                        supersedes_event_id=None,
                        created_at=observed_at,
                    )
                )
                created += 1
        if len(owners) == 1:
            await connection.execute(
                messages.update()
                .where(
                    messages.c.id.in_([message["id"] for message in group]),
                    messages.c.user_id == uid,
                )
                .values(application_id=owners[0])
            )
            linked += len(group)
        elif len(owners) > 1:
            ambiguous += len(group)

    case_rows = (
        (await connection.execute(select(outcome_cases).where(outcome_cases.c.user_id == uid)))
        .mappings()
        .all()
    )
    for case in case_rows:
        candidates = [
            app
            for app in application_rows
            if app["encrypt_job_id"] == case["encrypt_job_id"]
            and (
                not case["conversation_key"] or app["conversation_key"] == case["conversation_key"]
            )
            and (not case["boss_id"] or app["boss_id"] == case["boss_id"])
        ]
        if len(candidates) != 1:
            continue
        app = candidates[0]
        projection = loads(case["facts_json"], {}).get("projection", {})
        if not isinstance(projection, dict) or not projection:
            continue
        as_of = int(projection.get("asOf") or case["last_observed_at"] or 0)
        read_state = projection.get("readState", "UNKNOWN")
        new_status = _migrated_projection_status(app, projection)
        values = {"updated_at": max(app["updated_at"] or 0, as_of)}
        if read_state in {"READ", "UNREAD"} and as_of >= (app["read_state_updated_at"] or 0):
            values.update(read_state=read_state, read_state_updated_at=as_of)
        current_status = app["application_status"] or "DISCOVERED"
        if STATUS_PRIORITY.get(new_status, 0) > STATUS_PRIORITY.get(current_status, 0) or (
            STATUS_PRIORITY.get(new_status, 0) == STATUS_PRIORITY.get(current_status, 0)
            and as_of >= (app["status_updated_at"] or 0)
        ):
            values.update(
                application_status=new_status,
                status_updated_at=as_of,
                status_evidence_json=dumps(
                    {
                        "source": "MIGRATED_OUTCOME_CASE",
                        "caseId": case["id"],
                        "asOf": as_of,
                        "projection": projection,
                    }
                ),
            )
        if len(values) > 1:
            await connection.execute(
                applications.update()
                .where(applications.c.id == app["id"], applications.c.user_id == uid)
                .values(**values)
            )
            app.update(**values)
            status_updated += 1
    owner = await db.user(uid, connection)
    evaluated_at = now_ms()
    invalid = valid = unknown = 0
    for app in application_rows:
        values = validity_columns(
            loads(app["data_json"], {}),
            (owner or {}).get("preference"),
            observed_at=evaluated_at,
            source="APPLICATION_LEDGER_MIGRATION",
        )
        await connection.execute(
            applications.update()
            .where(applications.c.id == app["id"], applications.c.user_id == uid)
            .values(**values)
        )
        app.update(**values)
        if values["application_validity"] == "INVALID":
            invalid += 1
        elif values["application_validity"] == "VALID":
            valid += 1
        else:
            unknown += 1
    return {
        "version": 1,
        "applications": len(application_rows),
        "createdApplications": created,
        "boundApplications": bound,
        "linkedMessages": linked,
        "ambiguousMessages": ambiguous,
        "statusApplications": status_updated,
        "invalidApplications": invalid,
        "validApplications": valid,
        "unknownApplications": unknown,
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
            history_seeded = False
            ledger_seeded = False
            if "py_api_control" in names:
                marker = await connection.scalar(
                    text(
                        "SELECT value_json FROM py_api_control WHERE user_id=:uid AND control_key=:key"
                    ),
                    {"uid": config.owner_user_id, "key": PAUSE_MARKER},
                )
                seeded = loads(marker, False) is True
                history_marker = await connection.scalar(
                    text(
                        "SELECT value_json FROM py_api_control WHERE user_id=:uid AND control_key=:key"
                    ),
                    {"uid": config.owner_user_id, "key": MIGRATION_MARKER},
                )
                history_seeded = bool(loads(history_marker, None))
                ledger_marker = await connection.scalar(
                    text(
                        "SELECT value_json FROM py_api_control WHERE user_id=:uid AND control_key=:key"
                    ),
                    {"uid": config.owner_user_id, "key": APPLICATION_LEDGER_MARKER},
                )
                ledger_seeded = bool(loads(ledger_marker, None))
            plan = [
                "create " + name for name in (*OWN_TABLES, *sorted(optional)) if name not in names
            ]
            alterations: list[str] = []
            post_alterations: list[str] = []
            history_schema_changed = False
            ledger_schema_changed = False
            if "automation_job" in names:
                automation_columns = await connection.run_sync(
                    lambda c: {col["name"] for col in inspect(c).get_columns("automation_job")}
                )
                if "graph_finalized" not in automation_columns:
                    alterations.append(
                        "ALTER TABLE automation_job ADD COLUMN graph_finalized INTEGER NOT NULL DEFAULT 1"
                    )
            if "conversation_message" in names:
                history_columns = {
                    column["name"]: column
                    for column in await connection.run_sync(
                        lambda c: inspect(c).get_columns("conversation_message")
                    )
                }
                binary_mid = (
                    "VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
                    if db.engine.dialect.name == "mysql"
                    else "VARCHAR(160)"
                )
                if "causal_after_message_id" not in history_columns:
                    alterations.append(
                        "ALTER TABLE conversation_message ADD COLUMN "
                        f"causal_after_message_id {binary_mid} NULL"
                    )
                    history_schema_changed = True
                application_id_type = (
                    "VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
                    if db.engine.dialect.name == "mysql"
                    else "VARCHAR(36)"
                )
                if "application_id" not in history_columns:
                    alterations.append(
                        "ALTER TABLE conversation_message ADD COLUMN "
                        f"application_id {application_id_type} NULL"
                    )
                    ledger_schema_changed = True
                if "causal_root_message_id" not in history_columns:
                    alterations.append(
                        "ALTER TABLE conversation_message ADD COLUMN "
                        f"causal_root_message_id {binary_mid} NULL"
                    )
                    history_schema_changed = True
                if "causal_depth" not in history_columns:
                    alterations.append(
                        "ALTER TABLE conversation_message ADD COLUMN "
                        "causal_depth INTEGER NOT NULL DEFAULT 0"
                    )
                    history_schema_changed = True
                root_column = history_columns.get("causal_root_message_id")
                if db.engine.dialect.name == "mysql" and (
                    root_column is None or root_column["nullable"]
                ):
                    post_alterations.append(
                        "ALTER TABLE conversation_message MODIFY COLUMN "
                        f"causal_root_message_id {binary_mid} NOT NULL"
                    )
                history_indexes = {
                    item["name"]
                    for item in await connection.run_sync(
                        lambda c: inspect(c).get_indexes("conversation_message")
                    )
                }
                if "ix_conversation_message_application" not in history_indexes:
                    alterations.append(
                        "CREATE INDEX ix_conversation_message_application "
                        "ON conversation_message (user_id, application_id, order_at, id)"
                    )
                    ledger_schema_changed = True
            if "career_application" in names:
                application_columns = {
                    column["name"]: column
                    for column in await connection.run_sync(
                        lambda c: inspect(c).get_columns("career_application")
                    )
                }
                long_text = "LONGTEXT" if db.engine.dialect.name == "mysql" else "TEXT"
                ledger_columns = {
                    "origin": "VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN'",
                    "job_title": "VARCHAR(255) NULL",
                    "company_name": "VARCHAR(255) NULL",
                    "recruiter_name": "VARCHAR(255) NULL",
                    "salary_text": "VARCHAR(255) NULL",
                    "location_text": "VARCHAR(500) NULL",
                    "jd_text": f"{long_text} NULL",
                    "snapshot_completeness": "VARCHAR(16) NOT NULL DEFAULT 'PARTIAL'",
                    "application_validity": "VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN'",
                    "validity_reason_code": "VARCHAR(64) NULL",
                    "validity_evidence_json": f"{long_text} NULL",
                    "validity_updated_at": "BIGINT NULL",
                    "read_state": "VARCHAR(16) NOT NULL DEFAULT 'UNKNOWN'",
                    "read_state_updated_at": "BIGINT NULL",
                    "application_status": "VARCHAR(32) NOT NULL DEFAULT 'DISCOVERED'",
                    "status_updated_at": "BIGINT NULL",
                    "status_evidence_json": f"{long_text} NULL",
                    "first_observed_at": "BIGINT NULL",
                    "updated_at": "BIGINT NOT NULL DEFAULT 0",
                }
                for column_name, definition in ledger_columns.items():
                    if column_name not in application_columns:
                        alterations.append(
                            f"ALTER TABLE career_application ADD COLUMN {column_name} {definition}"
                        )
                        ledger_schema_changed = True
                application_indexes = {
                    item["name"]
                    for item in await connection.run_sync(
                        lambda c: inspect(c).get_indexes("career_application")
                    )
                }
                if "ix_career_application_status" not in application_indexes:
                    alterations.append(
                        "CREATE INDEX ix_career_application_status "
                        "ON career_application (user_id, application_status, updated_at)"
                    )
                    ledger_schema_changed = True
                if "ix_career_application_validity" not in application_indexes:
                    alterations.append(
                        "CREATE INDEX ix_career_application_validity "
                        "ON career_application (user_id, application_validity, updated_at)"
                    )
                    ledger_schema_changed = True
                if "ix_career_application_job" not in application_indexes:
                    alterations.append(
                        "CREATE INDEX ix_career_application_job "
                        "ON career_application (user_id, encrypt_job_id, created_at)"
                    )
                    ledger_schema_changed = True
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
            plan.extend(post_alterations)
            needs_history_backfill = (
                "conversation_message" not in names or not history_seeded or history_schema_changed
            )
            if needs_history_backfill:
                plan.append("backfill exact canonical conversation history")
            needs_ledger_backfill = (
                "career_application" not in names
                or "conversation_message" not in names
                or not ledger_seeded
                or ledger_schema_changed
            )
            if needs_ledger_backfill:
                plan.append("backfill unified application ledger")
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
            await connection.execute(
                text(
                    "UPDATE conversation_message "
                    "SET causal_root_message_id=message_id "
                    "WHERE causal_root_message_id IS NULL OR causal_root_message_id=''"
                )
            )
            for statement in post_alterations:
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
                if needs_history_backfill:
                    stats = await backfill_exact(db, connection, config.owner_user_id)
                    await db.set_control(
                        connection,
                        config.owner_user_id,
                        MIGRATION_MARKER,
                        {"version": 2, **stats},
                    )
                if needs_ledger_backfill:
                    ledger_stats = await backfill_application_ledger(
                        db, connection, config.owner_user_id
                    )
                    await db.set_control(
                        connection,
                        config.owner_user_id,
                        APPLICATION_LEDGER_MARKER,
                        ledger_stats,
                    )
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
