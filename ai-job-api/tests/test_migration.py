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


def test_conversation_history_backfill_skips_legacy_synthetic_mid_and_marks_completion(world):
    payload = {
        "eventId": "legacy-synthetic-event",
        "encryptJobId": "legacy-job",
        "conversationKey": "legacy-conversation",
        "bossId": "legacy-peer",
        "source": "BOSS_PASSIVE_MESSAGE",
        "observedAt": 1_700_000_000_000,
        "bindingObservedAt": 1_700_000_000_000,
        "messages": [
            {
                "messageId": "legacy-synthetic-mid",
                "clientMessageId": None,
                "role": "HR",
                "text": "历史消息",
                "sentAt": 1_700_000_000_000,
                "deliveryState": "UNKNOWN",
            }
        ],
        "readEvidence": None,
        "coverage": None,
    }
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE user_info SET ai_seat_status=0 WHERE id=3")
        connection.execute(
            "INSERT INTO outcome_observation(id,user_id,event_id,case_id,payload_hash,source,"
            "observed_at,received_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                "legacy-observation",
                3,
                payload["eventId"],
                "legacy-case",
                "0" * 64,
                payload["source"],
                payload["observedAt"],
                payload["observedAt"],
                json.dumps(payload, ensure_ascii=False),
            ),
        )

    plan = asyncio.run(migration.migrate(world["settings"], apply=True))
    assert "backfill exact canonical conversation history" in plan
    with sqlite3.connect(world["path"]) as connection:
        assert connection.execute("SELECT COUNT(*) FROM conversation_message").fetchone()[0] == 0
        marker = json.loads(
            connection.execute(
                "SELECT value_json FROM py_api_control "
                "WHERE user_id=3 AND control_key='migration:conversation-history-v2'"
            ).fetchone()[0]
        )
        assert marker["version"] == 2
        assert marker["skipped"] >= 1
    assert asyncio.run(migration.migrate(world["settings"], apply=False)) == []


def test_conversation_history_v2_repairs_partially_migrated_v1_table_idempotently(world):
    stamp = 1_700_000_005_000
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE user_info SET ai_seat_status=0 WHERE id=3")
        connection.execute(
            "INSERT INTO py_api_control(user_id,control_key,value_json,updated_at) "
            "VALUES (3,'migration:conversation-history-v1','{\"version\":1}',?)",
            (stamp,),
        )
        # Simulate a process that committed only the first v2 ALTER before stopping.
        connection.execute("ALTER TABLE conversation_message DROP COLUMN causal_root_message_id")
        connection.execute("ALTER TABLE conversation_message DROP COLUMN causal_depth")
        connection.execute(
            "INSERT INTO conversation_message("
            "id,user_id,conversation_id,platform_account,conversation_key,boss_id,"
            "encrypt_job_id,message_id,client_mid,role,author_kind,text,text_hash,sent_at,"
            "observed_at,order_at,order_confidence,causal_after_message_id,delivery_state,"
            "model_eligible,sources_json,created_at,updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "partial-history-row",
                3,
                "c" * 64,
                "boss-owner",
                "partial-conversation",
                "partial-peer",
                "partial-job",
                "55001",
                None,
                "HR",
                "HR",
                "partial row",
                "0" * 64,
                stamp,
                stamp,
                stamp,
                "PLATFORM",
                None,
                "OBSERVED",
                1,
                "[]",
                stamp,
                stamp,
            ),
        )

    plan = asyncio.run(migration.migrate(world["settings"], apply=True))
    assert any("ADD COLUMN causal_root_message_id" in step for step in plan)
    assert any("ADD COLUMN causal_depth" in step for step in plan)
    assert "backfill exact canonical conversation history" in plan
    with sqlite3.connect(world["path"]) as connection:
        columns = {
            row[1]: row for row in connection.execute("PRAGMA table_info(conversation_message)")
        }
        assert {
            "causal_after_message_id",
            "causal_root_message_id",
            "causal_depth",
        } <= columns.keys()
        assert connection.execute(
            "SELECT causal_after_message_id,causal_root_message_id,causal_depth "
            "FROM conversation_message WHERE id='partial-history-row'"
        ).fetchone() == (None, "55001", 0)
        marker = json.loads(
            connection.execute(
                "SELECT value_json FROM py_api_control "
                "WHERE user_id=3 AND control_key='migration:conversation-history-v2'"
            ).fetchone()[0]
        )
        assert marker["version"] == 2
    assert asyncio.run(migration.migrate(world["settings"], apply=False)) == []


def test_conversation_history_v2_backfill_materializes_snapshot_causal_chain(world):
    stamp = 1_700_000_006_000
    payload = {
        "eventId": "legacy-causal-snapshot",
        "platformAccount": "boss-owner",
        "encryptJobId": "legacy-causal-job",
        "conversationKey": "legacy-causal-conversation",
        "bossId": "legacy-causal-peer",
        "source": "BOSS_CONVERSATION_SNAPSHOT",
        "observedAt": stamp,
        "bindingObservedAt": stamp,
        "messages": [
            {
                "messageId": "88003",
                "clientMessageId": None,
                "role": "HR",
                "text": "legacy H1",
                "sentAt": stamp,
                "deliveryState": "UNKNOWN",
            },
            {
                "messageId": "12002",
                "clientMessageId": "91002",
                "role": "USER",
                "text": "legacy HUMAN",
                "sentAt": stamp,
                "deliveryState": "ACKNOWLEDGED",
            },
            {
                "messageId": "76001",
                "clientMessageId": None,
                "role": "HR",
                "text": "legacy H2",
                "sentAt": stamp,
                "deliveryState": "UNKNOWN",
            },
        ],
        "readEvidence": None,
        "coverage": None,
    }
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE user_info SET ai_seat_status=0 WHERE id=3")
        connection.execute(
            "INSERT INTO outcome_observation(id,user_id,event_id,case_id,payload_hash,source,"
            "observed_at,received_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                "legacy-causal-observation",
                3,
                payload["eventId"],
                "legacy-causal-case",
                "1" * 64,
                payload["source"],
                stamp,
                stamp,
                json.dumps(payload, ensure_ascii=False),
            ),
        )

    asyncio.run(migration.migrate(world["settings"], apply=True))
    with sqlite3.connect(world["path"]) as connection:
        assert connection.execute(
            "SELECT message_id,causal_after_message_id,causal_root_message_id,causal_depth "
            "FROM conversation_message WHERE conversation_key='legacy-causal-conversation' "
            "ORDER BY causal_depth"
        ).fetchall() == [
            ("88003", None, "88003", 0),
            ("12002", "88003", "88003", 1),
            ("76001", "12002", "88003", 2),
        ]


def test_application_ledger_backfill_links_only_unique_exact_cycles(world):
    stamp = 1_700_000_008_000
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE user_info SET ai_seat_status=0 WHERE id=3")
        applications = [
            ("unique-app", "key-unique", "unique-job", "unique-conversation", "unique-peer"),
            (
                "ambiguous-a",
                "key-ambiguous-a",
                "ambiguous-job",
                "ambiguous-conversation",
                "ambiguous-peer",
            ),
            (
                "ambiguous-b",
                "key-ambiguous-b",
                "ambiguous-job",
                "ambiguous-conversation",
                "ambiguous-peer",
            ),
        ]
        for app_id, application_key, job, conversation, peer in applications:
            connection.execute(
                "INSERT INTO career_application("
                "id,user_id,application_key,platform_account,encrypt_job_id,conversation_key,boss_id,"
                "cycle_key,data_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    app_id,
                    3,
                    application_key,
                    "boss-owner",
                    job,
                    conversation,
                    peer,
                    application_key,
                    json.dumps({"jobTitle": job}),
                    stamp,
                ),
            )
        connection.execute(
            "UPDATE career_application SET contacted_at=?, application_status='EXPLICIT_REJECTED', "
            "status_updated_at=? WHERE id='unique-app'",
            (stamp - 100, stamp - 50),
        )
        messages = [
            ("unique-message", "unique-job", "unique-conversation", "unique-peer", "980001"),
            (
                "ambiguous-message",
                "ambiguous-job",
                "ambiguous-conversation",
                "ambiguous-peer",
                "980002",
            ),
        ]
        for row_id, job, conversation, peer, message_id in messages:
            connection.execute(
                "INSERT INTO conversation_message("
                "id,user_id,conversation_id,platform_account,conversation_key,boss_id,encrypt_job_id,"
                "message_id,role,author_kind,text,text_hash,observed_at,order_at,order_confidence,"
                "causal_root_message_id,causal_depth,delivery_state,model_eligible,sources_json,"
                "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    row_id,
                    3,
                    row_id + "-conversation-id",
                    "boss-owner",
                    conversation,
                    peer,
                    job,
                    message_id,
                    "HR",
                    "HR",
                    "历史消息",
                    "0" * 64,
                    stamp,
                    stamp,
                    "PLATFORM",
                    message_id,
                    0,
                    "OBSERVED",
                    1,
                    "[]",
                    stamp,
                    stamp,
                ),
            )

    plan = asyncio.run(migration.migrate(world["settings"], apply=True))
    assert "backfill unified application ledger" in plan
    with sqlite3.connect(world["path"]) as connection:
        assert connection.execute(
            "SELECT application_id FROM conversation_message WHERE id='unique-message'"
        ).fetchone() == ("unique-app",)
        assert connection.execute(
            "SELECT application_status FROM career_application WHERE id='unique-app'"
        ).fetchone() == ("EXPLICIT_REJECTED",)
        assert connection.execute(
            "SELECT application_id FROM conversation_message WHERE id='ambiguous-message'"
        ).fetchone() == (None,)
        marker = json.loads(
            connection.execute(
                "SELECT value_json FROM py_api_control "
                "WHERE user_id=3 AND control_key='migration:application-ledger-v2'"
            ).fetchone()[0]
        )
        assert marker["linkedMessages"] == 1
        assert marker["ambiguousMessages"] == 1
    assert asyncio.run(migration.migrate(world["settings"], apply=False)) == []


def test_application_ledger_creates_missing_manual_and_assistant_records(world):
    stamp = 1_700_000_009_000
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "UPDATE user_info SET ai_seat_status=0, preference=? WHERE id=3",
            (json.dumps({"sr": "13-18"}),),
        )
        connection.execute(
            "INSERT INTO job_application_snapshot("
            "user_id,encrypt_job_id,applied_at,job_base_info,job_ext_info,jd_hash,"
            "resume_record_id,resume_content,resume_hash,preference_snapshot,pre_match_result,created_at"
            ") VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                3,
                "assistant-job",
                stamp - 500,
                json.dumps(
                    {
                        "jobName": "后端工程师",
                        "brandName": "完整公司",
                        "salaryDesc": "25-35K",
                        "cityName": "上海",
                        "areaDistrict": "浦东新区",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {"address": "张江", "postDescription": "负责 Python 服务"},
                    ensure_ascii=False,
                ),
                "a" * 64,
                7,
                "投递时简历全文",
                "b" * 64,
                json.dumps({"city": "上海"}, ensure_ascii=False),
                json.dumps({"matched": True}),
                stamp - 500,
            ),
        )
        messages = [
            (
                "manual-history-message",
                "manual-job",
                "manual-conversation",
                "manual-peer",
                "990001",
            ),
            (
                "assistant-history-message",
                "assistant-job",
                "assistant-conversation",
                "assistant-peer",
                "990002",
            ),
        ]
        for row_id, job, conversation, peer, message_id in messages:
            connection.execute(
                "INSERT INTO conversation_message("
                "id,user_id,conversation_id,platform_account,conversation_key,boss_id,encrypt_job_id,"
                "message_id,role,author_kind,text,text_hash,observed_at,order_at,order_confidence,"
                "causal_root_message_id,causal_depth,delivery_state,model_eligible,sources_json,"
                "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    row_id,
                    3,
                    row_id + "-conversation-id",
                    "boss-owner",
                    conversation,
                    peer,
                    job,
                    message_id,
                    "HR",
                    "HR",
                    "历史消息",
                    "0" * 64,
                    stamp,
                    stamp,
                    "PLATFORM",
                    message_id,
                    0,
                    "OBSERVED",
                    1,
                    "[]",
                    stamp,
                    stamp,
                ),
            )
        connection.execute(
            "INSERT INTO outcome_case("
            "id,user_id,case_key,encrypt_job_id,conversation_key,boss_id,revision,facts_json,"
            "status,last_observed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "manual-outcome-case",
                3,
                "manual-outcome-key",
                "manual-job",
                "manual-conversation",
                "manual-peer",
                1,
                json.dumps(
                    {
                        "projection": {
                            "outcome": "NO_REPLY",
                            "readState": "READ",
                            "waitingOn": "HR",
                            "asOf": stamp + 100,
                            "evidence": [],
                        }
                    }
                ),
                "COMPLETE",
                stamp + 100,
                stamp,
                stamp,
            ),
        )

    asyncio.run(migration.migrate(world["settings"], apply=True))
    with sqlite3.connect(world["path"]) as connection:
        connection.row_factory = sqlite3.Row
        manual = connection.execute(
            "SELECT * FROM career_application WHERE encrypt_job_id='manual-job'"
        ).fetchone()
        assistant = connection.execute(
            "SELECT * FROM career_application WHERE encrypt_job_id='assistant-job'"
        ).fetchone()
        assert manual["origin"] == "MANUAL_DISCOVERED"
        assert manual["snapshot_completeness"] == "PARTIAL"
        assert manual["read_state"] == "READ"
        assert manual["application_status"] == "SOFT_REJECTED"
        assert set(json.loads(manual["data_json"])["missingFields"]) == {
            "jobTitle",
            "companyName",
            "recruiterName",
            "salaryText",
            "locationText",
            "jdText",
        }
        assert assistant["origin"] == "ASSISTANT"
        assert assistant["application_status"] == "APPLIED"
        assert assistant["job_title"] == "后端工程师"
        assert assistant["company_name"] == "完整公司"
        assert assistant["salary_text"] == "25-35K"
        assert assistant["application_validity"] == "INVALID"
        assert assistant["validity_reason_code"] == "SALARY_OUTSIDE_TARGET"
        assert assistant["location_text"] == "上海 浦东新区 张江"
        assert assistant["jd_text"] == "负责 Python 服务"
        assert json.loads(assistant["data_json"])["capturedResumeContent"] == "投递时简历全文"
        linked = connection.execute(
            "SELECT encrypt_job_id,application_id FROM conversation_message "
            "WHERE id IN ('manual-history-message','assistant-history-message') "
            "ORDER BY encrypt_job_id"
        ).fetchall()
        assert [(row[0], row[1]) for row in linked] == [
            ("assistant-job", assistant["id"]),
            ("manual-job", manual["id"]),
        ]
        assert (
            connection.execute(
                "SELECT event_type FROM career_application_event WHERE application_id=?",
                (manual["id"],),
            ).fetchone()[0]
            == "APPLICATION_DISCOVERED"
        )
        marker = json.loads(
            connection.execute(
                "SELECT value_json FROM py_api_control "
                "WHERE user_id=3 AND control_key='migration:application-ledger-v2'"
            ).fetchone()[0]
        )
        assert marker["createdApplications"] == 2
        assert marker["linkedMessages"] == 2
        assert marker["statusApplications"] == 1
        assert marker["invalidApplications"] == 1
    assert asyncio.run(migration.migrate(world["settings"], apply=False)) == []


def test_application_ledger_repairs_missing_message_link_column_idempotently(world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute("UPDATE user_info SET ai_seat_status=0 WHERE id=3")
        connection.execute("DROP INDEX ix_conversation_message_application")
        connection.execute("ALTER TABLE conversation_message DROP COLUMN application_id")

    plan = asyncio.run(migration.migrate(world["settings"], apply=True))
    assert any("ADD COLUMN application_id" in step for step in plan)
    assert any("CREATE INDEX ix_conversation_message_application" in step for step in plan)
    with sqlite3.connect(world["path"]) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(conversation_message)")}
        indexes = {row[1] for row in connection.execute("PRAGMA index_list(conversation_message)")}
        assert "application_id" in columns
        assert "ix_conversation_message_application" in indexes
    assert asyncio.run(migration.migrate(world["settings"], apply=False)) == []
