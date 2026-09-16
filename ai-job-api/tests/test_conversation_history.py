import asyncio
import json
import sqlite3
import time
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from job_helper_api.automation.contracts import JobInput
from job_helper_api.automation.conversation_history import (
    append_manual_turn,
    freeze_recent,
    project_observations,
    record_action_ack,
    record_inbound_job,
    upsert_message,
)
from job_helper_api.database import Database
from job_helper_api.errors import ApiError
from job_helper_api.main import create_app

INTERNAL_TOKEN = "conversation-history-internal-" * 2
INTERNAL = {"X-Internal-Token": INTERNAL_TOKEN}
BASE = "/api/job/automation"


def _message(**changes):
    values = dict(
        platform_account="boss-owner",
        conversation_key="conversation-a",
        boss_id="peer-a",
        encrypt_job_id="job-a",
        message_id="10001",
        client_mid=None,
        role="HR",
        author_kind="HR",
        text="请介绍一下你的项目经验",
        sent_at=1_700_000_000_000,
        observed_at=1_700_000_000_010,
        delivery_state="OBSERVED",
        order_confidence="PLATFORM",
        source="TEST",
    )
    values.update(changes)
    return values


def test_canonical_upsert_alias_conflict_and_conversation_isolation(world):
    async def scenario():
        db = Database(world["settings"].database_url)
        await db.open()
        try:
            async with db.engine.begin() as c:
                first = await upsert_message(db, c, 3, **_message())
                replay = await upsert_message(db, c, 3, **_message())
                other = await upsert_message(
                    db,
                    c,
                    3,
                    **_message(
                        conversation_key="conversation-b",
                        message_id="10001",
                        text="另一个会话",
                    ),
                )
                assert first["created"] is True
                assert replay["created"] is False and replay["changed"] is False
                assert other["conversation_id"] != first["conversation_id"]
                with pytest.raises(ApiError, match="MESSAGE_ALIAS_CONFLICT"):
                    await upsert_message(
                        db,
                        c,
                        3,
                        **_message(
                            message_id="10002",
                            client_mid="20001",
                            role="USER",
                            author_kind="HUMAN",
                            text="人工回复",
                            delivery_state="ACKNOWLEDGED",
                            order_confidence="ACK",
                        ),
                    )
                    await upsert_message(
                        db,
                        c,
                        3,
                        **_message(
                            message_id="10003",
                            client_mid="20001",
                            role="USER",
                            author_kind="HUMAN",
                            text="人工回复",
                            delivery_state="ACKNOWLEDGED",
                            order_confidence="ACK",
                        ),
                    )
        finally:
            await db.close()

    asyncio.run(scenario())
    with sqlite3.connect(world["path"]) as c:
        assert c.execute("SELECT COUNT(*) FROM conversation_message").fetchone()[0] == 3


@pytest.mark.parametrize(
    ("changes", "error"),
    [
        ({"message_id": "server-1"}, "EXACT_SERVER_MID_REQUIRED"),
        ({"message_id": "0"}, "EXACT_SERVER_MID_REQUIRED"),
        ({"message_id": "-1"}, "EXACT_SERVER_MID_REQUIRED"),
        (
            {
                "message_id": "10002",
                "client_mid": "client-1",
                "role": "USER",
                "author_kind": "HUMAN",
            },
            "EXACT_CLIENT_MID_REQUIRED",
        ),
        (
            {
                "message_id": "10002",
                "client_mid": "0",
                "role": "USER",
                "author_kind": "HUMAN",
            },
            "EXACT_CLIENT_MID_REQUIRED",
        ),
        (
            {
                "message_id": "10002",
                "client_mid": "10002",
                "role": "USER",
                "author_kind": "HUMAN",
            },
            "MESSAGE_ALIAS_CONFLICT",
        ),
    ],
)
def test_exact_message_identity_rejects_non_positive_or_non_decimal_ids(world, changes, error):
    async def scenario():
        db = Database(world["settings"].database_url)
        await db.open()
        try:
            async with db.engine.begin() as c:
                with pytest.raises(ApiError, match=error):
                    await upsert_message(db, c, 3, **_message(**changes))
        finally:
            await db.close()

    asyncio.run(scenario())


def test_manual_turn_is_atomic_idempotent_and_freezes_only_exact_conversation(world):
    async def scenario():
        db = Database(world["settings"].database_url)
        await db.open()
        args = dict(
            platform_account="boss-owner",
            conversation_key="manual-conversation",
            boss_id="manual-peer",
            encrypt_job_id="manual-job",
            inbound_message_id="30001",
            inbound_sent_at=1_700_000_001_000,
            inbound_text="目前是在职吗？",
            outbound_message_id="30002",
            outbound_client_mid="40001",
            outbound_sent_at=1_700_000_002_000,
            outbound_text="是的，目前在职。",
            event_id="manual-event",
        )
        try:
            async with db.engine.begin() as c:
                assert await append_manual_turn(db, c, 3, **args) is True
                assert await append_manual_turn(db, c, 3, **args) is False
                frozen = await freeze_recent(
                    db,
                    c,
                    3,
                    platform_account=args["platform_account"],
                    conversation_key=args["conversation_key"],
                    boss_id=args["boss_id"],
                    encrypt_job_id=args["encrypt_job_id"],
                )
                assert frozen["history"] == [
                    {"role": "user", "content": args["inbound_text"]},
                    {"role": "assistant", "content": args["outbound_text"]},
                ]
                assert frozen["historyMessageIds"] == [
                    args["inbound_message_id"],
                    args["outbound_message_id"],
                ]
            with pytest.raises(ApiError, match="CONVERSATION_TEXT_CONFLICT"):
                async with db.engine.begin() as c:
                    await append_manual_turn(
                        db, c, 3, **{**args, "outbound_text": "冲突的人工回复"}
                    )
        finally:
            await db.close()

    asyncio.run(scenario())
    with sqlite3.connect(world["path"]) as c:
        rows = c.execute(
            "SELECT role,author_kind,message_id FROM conversation_message ORDER BY order_at"
        ).fetchall()
        assert rows == [
            ("HR", "HR", "30001"),
            ("USER", "HUMAN", "30002"),
        ]


def test_causal_chain_upgrade_rebases_descendants_and_conflicts_do_not_rewrite_it(world):
    async def scenario():
        db = Database(world["settings"].database_url)
        await db.open()
        stamp = 1_700_000_003_000
        try:
            async with db.engine.begin() as c:
                await upsert_message(
                    db, c, 3, **_message(message_id="41001", sent_at=stamp, text="root")
                )
                await upsert_message(
                    db,
                    c,
                    3,
                    **_message(message_id="41002", sent_at=stamp, text="legacy child"),
                )
                await upsert_message(
                    db,
                    c,
                    3,
                    **_message(message_id="41003", sent_at=stamp, text="descendant"),
                    causal_after_message_id="41002",
                )
                upgraded = await upsert_message(
                    db,
                    c,
                    3,
                    **_message(message_id="41002", sent_at=stamp, text="legacy child"),
                    causal_after_message_id="41001",
                )
                assert upgraded["causal_root_message_id"] == "41001"
                assert upgraded["causal_depth"] == 1
                with pytest.raises(ApiError, match="CONVERSATION_CAUSAL_CONFLICT"):
                    await upsert_message(
                        db,
                        c,
                        3,
                        **_message(message_id="41002", sent_at=stamp, text="legacy child"),
                        causal_after_message_id="41003",
                    )
                with pytest.raises(ApiError, match="CONVERSATION_CAUSAL_CONFLICT"):
                    await upsert_message(
                        db,
                        c,
                        3,
                        **_message(message_id="41001", sent_at=stamp, text="root"),
                        causal_after_message_id="41003",
                    )
                frozen = await freeze_recent(
                    db,
                    c,
                    3,
                    platform_account="boss-owner",
                    conversation_key="conversation-a",
                    boss_id="peer-a",
                    encrypt_job_id="job-a",
                )
                assert frozen["historyMessageIds"] == ["41001", "41002", "41003"]
                assert frozen["historyCausalDepths"] == [0, 1, 2]
        finally:
            await db.close()

    asyncio.run(scenario())
    with sqlite3.connect(world["path"]) as connection:
        assert connection.execute(
            "SELECT causal_after_message_id,causal_root_message_id,causal_depth "
            "FROM conversation_message WHERE message_id='41002'"
        ).fetchone() == ("41001", "41001", 1)
        assert connection.execute(
            "SELECT causal_after_message_id,causal_root_message_id,causal_depth "
            "FROM conversation_message WHERE message_id='41003'"
        ).fetchone() == ("41002", "41001", 2)


def test_concurrent_replay_converges_on_one_row(world):
    async def writer():
        db = Database(world["settings"].database_url)
        await db.open()
        try:
            async with db.engine.begin() as c:
                return await upsert_message(db, c, 3, **_message(message_id="50001"))
        finally:
            await db.close()

    async def scenario():
        return await asyncio.gather(writer(), writer())

    results = asyncio.run(scenario())
    assert sum(int(row["created"]) for row in results) == 1
    with sqlite3.connect(world["path"]) as c:
        assert (
            c.execute(
                "SELECT COUNT(*) FROM conversation_message WHERE message_id='50001'"
            ).fetchone()[0]
            == 1
        )


def test_concurrent_causal_replay_keeps_one_child_with_the_same_predecessor(world):
    async def seed():
        db = Database(world["settings"].database_url)
        await db.open()
        try:
            async with db.engine.begin() as c:
                await upsert_message(db, c, 3, **_message(message_id="51001", text="parent"))
        finally:
            await db.close()

    async def writer():
        db = Database(world["settings"].database_url)
        await db.open()
        try:
            async with db.engine.begin() as c:
                return await upsert_message(
                    db,
                    c,
                    3,
                    **_message(message_id="51002", text="child"),
                    causal_after_message_id="51001",
                )
        finally:
            await db.close()

    async def scenario():
        await seed()
        return await asyncio.gather(writer(), writer())

    results = asyncio.run(scenario())
    assert sum(int(row["created"]) for row in results) == 1
    with sqlite3.connect(world["path"]) as connection:
        assert connection.execute(
            "SELECT COUNT(*),MIN(causal_after_message_id),MIN(causal_root_message_id),"
            "MIN(causal_depth) FROM conversation_message WHERE message_id='51002'"
        ).fetchone() == (1, "51001", "51001", 1)


def test_ordinary_replies_chain_to_latest_confirmed_outbound_without_mid_ordering(world):
    async def scenario():
        db = Database(world["settings"].database_url)
        await db.open()
        stamp = 1_700_000_003_500
        binding = {
            "platformAccount": "boss-owner",
            "conversationKey": "ordinary-causal-conversation",
            "bossId": "ordinary-causal-peer",
            "encryptJobId": "ordinary-causal-job",
        }

        def reply(mid: str, question: str, request: str) -> JobInput:
            return JobInput(
                requestId=request,
                kind="REPLY",
                **binding,
                input={
                    "inboundMessageId": mid,
                    "inboundSentAt": stamp,
                    "question": question,
                    "jobKey": "ordinary-causal-job:boss-owner",
                    "jobInfo": {},
                    "exchangeRequest": None,
                },
            )

        async def ack(c, payload: JobInput, server_mid: str, text: str, suffix: str):
            return await record_action_ack(
                db,
                c,
                3,
                {
                    "id": "job-" + suffix,
                    "kind": "REPLY",
                    "platform_account": binding["platformAccount"],
                    "conversation_key": binding["conversationKey"],
                    "boss_id": binding["bossId"],
                    "encrypt_job_id": binding["encryptJobId"],
                    "input_json": json.dumps(payload.model_dump(mode="json")),
                },
                {
                    "id": "action-" + suffix,
                    "kind": "SEND_TEXT",
                    "status": "ACKNOWLEDGED",
                    "server_mid": server_mid,
                    "client_mid": str(int(server_mid) + 100_000),
                    "payload_json": json.dumps({"text": text}),
                    "updated_at": stamp,
                },
            )

        try:
            async with db.engine.begin() as c:
                h1 = reply("90005", "H1", "ordinary-h1")
                await record_inbound_job(db, c, 3, h1)
                await ack(c, h1, "80004", "AI1", "one")
                h2 = reply("70003", "H2", "ordinary-h2")
                await record_inbound_job(db, c, 3, h2)
                await ack(c, h2, "60002", "AI2", "two")
                h3 = reply("50001", "H3", "ordinary-h3")
                await record_inbound_job(db, c, 3, h3)
                for _ in range(10):
                    frozen = await freeze_recent(
                        db,
                        c,
                        3,
                        platform_account=binding["platformAccount"],
                        conversation_key=binding["conversationKey"],
                        boss_id=binding["bossId"],
                        encrypt_job_id=binding["encryptJobId"],
                    )
                    assert frozen["historyMessageIds"] == [
                        "90005",
                        "80004",
                        "70003",
                        "60002",
                        "50001",
                    ]
                    assert frozen["historyCausalAfterMessageIds"] == [
                        None,
                        "90005",
                        "80004",
                        "70003",
                        "60002",
                    ]
                    assert frozen["historyCausalDepths"] == [0, 1, 2, 3, 4]
        finally:
            await db.close()

    asyncio.run(scenario())


def test_outcome_projection_persists_exact_hr_message(world):
    settings = replace(
        world["settings"], outcome_enabled=True, outcome_internal_token=INTERNAL_TOKEN
    )
    stamp = int(time.time() * 1000)
    item = {
        "eventId": "canonical-outcome-event",
        "encryptJobId": "outcome-job",
        "conversationKey": "outcome-conversation",
        "bossId": "outcome-peer",
        "source": "BOSS_PASSIVE_MESSAGE",
        "observedAt": stamp,
        "bindingObservedAt": stamp,
        "messages": [
            {
                "messageId": "60001",
                "clientMessageId": None,
                "role": "HR",
                "text": "方便下周面试吗？",
                "sentAt": stamp - 100,
                "deliveryState": "UNKNOWN",
            }
        ],
        "readEvidence": None,
        "coverage": None,
    }
    with TestClient(create_app(settings, world["transport"])) as client:
        client.headers["Authorization"] = client.post(
            "/api/user/silently/login", params={"uniqueId": "boss-owner"}
        ).json()["data"]
        path = "/api/job/outcomes/observations"
        body = {"schemaVersion": 1, "observations": [item]}
        assert client.post(path, json=body).status_code == 200
        assert client.post(path, json=body).status_code == 200
        invalid = json.loads(json.dumps(item))
        invalid["eventId"] = "invalid-canonical-mid"
        invalid["messages"][0]["messageId"] = "server-not-decimal"
        assert (
            client.post(path, json={"schemaVersion": 1, "observations": [invalid]}).status_code
            == 200
        )
    with sqlite3.connect(world["path"]) as c:
        row = c.execute(
            "SELECT platform_account,role,author_kind,message_id,text "
            "FROM conversation_message WHERE message_id='60001'"
        ).fetchone()
        assert row == (
            "boss-owner",
            "HR",
            "HR",
            "60001",
            "方便下周面试吗？",
        )
        assert (
            c.execute(
                "SELECT COUNT(*) FROM conversation_message WHERE message_id='server-not-decimal'"
            ).fetchone()[0]
            == 0
        )


def test_snapshot_projection_preserves_same_timestamp_dom_causality_over_mid_magnitude(world):
    async def scenario():
        db = Database(world["settings"].database_url)
        await db.open()
        stamp = 1_700_000_004_000
        observation = {
            "eventId": "same-time-snapshot",
            "platformAccount": "boss-owner",
            "encryptJobId": "snapshot-job",
            "conversationKey": "snapshot-conversation",
            "bossId": "snapshot-peer",
            "source": "BOSS_CONVERSATION_SNAPSHOT",
            "observedAt": stamp,
            "messages": [
                {
                    "messageId": "85003",
                    "role": "HR",
                    "text": "snapshot H1",
                    "sentAt": stamp,
                    "deliveryState": "UNKNOWN",
                },
                {
                    "messageId": "12002",
                    "clientMessageId": "91002",
                    "role": "USER",
                    "text": "snapshot HUMAN",
                    "sentAt": stamp,
                    "deliveryState": "ACKNOWLEDGED",
                },
                {
                    "messageId": "73001",
                    "role": "HR",
                    "text": "snapshot H2",
                    "sentAt": stamp,
                    "deliveryState": "UNKNOWN",
                },
            ],
        }
        try:
            async with db.engine.begin() as c:
                assert await project_observations(db, c, 3, [observation]) == {
                    "inserted": 3,
                    "updated": 0,
                    "skipped": 0,
                }
                for _ in range(5):
                    frozen = await freeze_recent(
                        db,
                        c,
                        3,
                        platform_account="boss-owner",
                        conversation_key="snapshot-conversation",
                        boss_id="snapshot-peer",
                        encrypt_job_id="snapshot-job",
                    )
                    assert frozen["historyMessageIds"] == ["85003", "12002", "73001"]
                    assert frozen["historyCausalDepths"] == [0, 1, 2]
        finally:
            await db.close()

    asyncio.run(scenario())


def _response(response, expected=200):
    assert response.status_code == expected, response.text
    return response.json().get("data")


def test_acknowledged_ai_text_is_projected_in_the_receipt_transaction(world):
    settings = replace(
        world["settings"],
        automation_enabled=True,
        outcome_internal_token=INTERNAL_TOKEN,
    )
    world["fake"].output = "您好，我有三年 Python 项目经验。"
    with TestClient(create_app(settings, world["transport"])) as client:
        client.headers["Authorization"] = _response(
            client.post("/api/user/silently/login", params={"uniqueId": "boss-owner"})
        )
        payload = {
            "requestId": str(uuid4()),
            "kind": "REPLY",
            "platformAccount": "boss-owner",
            "conversationKey": "ack-conversation",
            "bossId": "ack-peer",
            "encryptJobId": "ack-job",
            "input": {
                "inboundMessageId": "70001",
                "inboundSentAt": int(time.time() * 1000),
                "question": "请介绍一下项目经验",
                "jobKey": "ack-job:boss-owner",
                "jobInfo": {},
                "exchangeRequest": None,
            },
        }
        job = _response(client.post(BASE + "/jobs", json=payload))
        claim = _response(
            client.post("/internal/automation/claim", headers=INTERNAL, json={"workerId": "w"})
        )
        lease = {key: claim[key] for key in ("leaseToken", "revision", "inputHash")}
        root = "/internal/automation/jobs/" + job["jobId"]
        _response(client.post(root + "/gather", headers=INTERNAL, json=lease))
        artifact = _response(client.post(root + "/compute", headers=INTERNAL, json=lease))
        commit = {**lease, "artifactId": artifact["artifactId"]}
        _response(client.post(root + "/validate", headers=INTERNAL, json=commit))
        _response(client.post(root + "/commit", headers=INTERNAL, json=commit))

        scope = {"executorId": "canonical-executor", "platformAccount": "boss-owner"}
        _response(
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
        action = _response(
            client.post(BASE + "/actions/claim", json={**scope, "jobId": job["jobId"]})
        )
        dispatched = _response(
            client.post(
                BASE + "/actions/" + action["actionId"] + "/dispatch",
                json={
                    **scope,
                    "leaseToken": action["leaseToken"],
                    "authorizationRevision": action["authorizationRevision"],
                    "clientMid": "99101",
                },
            )
        )
        receipt = {
            **scope,
            "requestId": str(uuid4()),
            "dispatchToken": dispatched["dispatchToken"],
            "clientMid": "99101",
            "status": "ACKNOWLEDGED",
            "serverMid": "99102",
            "platformCode": 0,
            "occurredAt": int(time.time() * 1000),
            "errorCode": None,
        }
        path = BASE + "/actions/" + action["actionId"] + "/receipt"
        assert client.post(path, json=receipt).status_code == 200
        assert client.post(path, json=receipt).status_code == 200

    with sqlite3.connect(world["path"]) as c:
        row = c.execute(
            "SELECT role,author_kind,message_id,client_mid,delivery_state,text "
            "FROM conversation_message WHERE message_id='99102'"
        ).fetchone()
        assert row == (
            "USER",
            "AI",
            "99102",
            "99101",
            "ACKNOWLEDGED",
            "您好，我有三年 Python 项目经验。",
        )
        assert json.loads(
            c.execute(
                "SELECT sources_json FROM conversation_message WHERE message_id='99102'"
            ).fetchone()[0]
        )[0].startswith("AUTOMATION_ACK:")


def test_history_time_conflict_does_not_rollback_acknowledged_platform_receipt(world):
    settings = replace(
        world["settings"],
        automation_enabled=True,
        outcome_internal_token=INTERNAL_TOKEN,
    )
    world["fake"].output = "平台已确认但本地历史时钟冲突"
    inbound_at = int(time.time() * 1000) - 1_000
    receipt_at = inbound_at - 1_000
    with TestClient(create_app(settings, world["transport"])) as client:
        client.headers["Authorization"] = _response(
            client.post("/api/user/silently/login", params={"uniqueId": "boss-owner"})
        )
        payload = {
            "requestId": "history-conflict-job-" + str(uuid4()),
            "kind": "REPLY",
            "platformAccount": "boss-owner",
            "conversationKey": "history-conflict-conversation",
            "bossId": "history-conflict-peer",
            "encryptJobId": "history-conflict-job",
            "input": {
                "inboundMessageId": "71001",
                "inboundSentAt": inbound_at,
                "question": "这个回执时钟有偏差",
                "jobKey": "history-conflict-job:boss-owner",
                "jobInfo": {},
                "exchangeRequest": None,
            },
        }
        job = _response(client.post(BASE + "/jobs", json=payload))
        claim = _response(
            client.post(
                "/internal/automation/claim",
                headers=INTERNAL,
                json={"workerId": "history-conflict-worker"},
            )
        )
        lease = {key: claim[key] for key in ("leaseToken", "revision", "inputHash")}
        root = "/internal/automation/jobs/" + job["jobId"]
        _response(client.post(root + "/gather", headers=INTERNAL, json=lease))
        artifact = _response(client.post(root + "/compute", headers=INTERNAL, json=lease))
        commit = {**lease, "artifactId": artifact["artifactId"]}
        _response(client.post(root + "/validate", headers=INTERNAL, json=commit))
        _response(client.post(root + "/commit", headers=INTERNAL, json=commit))

        scope = {"executorId": "history-conflict-executor", "platformAccount": "boss-owner"}
        _response(
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
        action = _response(
            client.post(BASE + "/actions/claim", json={**scope, "jobId": job["jobId"]})
        )
        dispatched = _response(
            client.post(
                BASE + "/actions/" + action["actionId"] + "/dispatch",
                json={
                    **scope,
                    "leaseToken": action["leaseToken"],
                    "authorizationRevision": action["authorizationRevision"],
                    "clientMid": "99201",
                },
            )
        )
        receipt = {
            **scope,
            "requestId": "history-conflict-receipt-" + str(uuid4()),
            "dispatchToken": dispatched["dispatchToken"],
            "clientMid": "99201",
            "status": "ACKNOWLEDGED",
            "serverMid": "99202",
            "platformCode": 0,
            "occurredAt": receipt_at,
            "errorCode": None,
        }
        path = BASE + "/actions/" + action["actionId"] + "/receipt"
        acknowledged = _response(client.post(path, json=receipt))
        assert acknowledged["status"] == "ACKNOWLEDGED"

    with sqlite3.connect(world["path"]) as connection:
        assert connection.execute(
            "SELECT status,server_mid,finalized FROM automation_action WHERE id=?",
            (action["actionId"],),
        ).fetchone() == ("ACKNOWLEDGED", "99202", 1)
        assert connection.execute(
            "SELECT COUNT(*) FROM automation_action_event WHERE action_id=? AND kind='RECEIPT'",
            (action["actionId"],),
        ).fetchone() == (1,)
        assert connection.execute(
            "SELECT COUNT(*) FROM conversation_message WHERE message_id='99202'"
        ).fetchone() == (0,)
        marker = connection.execute(
            "SELECT value_json FROM py_api_control WHERE user_id=3 AND control_key=?",
            ("conversation-history-repair:" + action["actionId"],),
        ).fetchone()
        assert marker is not None
        assert json.loads(marker[0])["error"] == "CONVERSATION_CAUSAL_TIME_CONFLICT"


def test_equal_timestamp_manual_inbound_and_ai_ack_follow_explicit_causal_chain(world):
    settings = replace(
        world["settings"],
        automation_enabled=True,
        outcome_internal_token=INTERNAL_TOKEN,
    )
    world["fake"].output = "AI 对第二个问题的回答"
    first_at = int(time.time() * 1000) - 10_000
    tied_at = first_at + 100
    binding = {
        "platformAccount": "boss-owner",
        "conversationKey": "equal-time-conversation",
        "bossId": "equal-time-peer",
        "encryptJobId": "equal-time-job",
    }
    with TestClient(create_app(settings, world["transport"])) as client:
        client.headers["Authorization"] = _response(
            client.post("/api/user/silently/login", params={"uniqueId": "boss-owner"})
        )
        takeover = {
            "requestId": "equal-time-manual-" + str(uuid4()),
            **binding,
            "jobKey": "equal-time-job:boss-owner",
            "throughInboundMessageId": "81001",
            "throughInboundSentAt": first_at,
            "throughInboundText": "H1",
            "manualOutboundClientMid": "99001",
            "manualOutboundMessageId": "99002",
            "manualOutboundSentAt": tied_at,
            "manualText": "HUMAN",
        }
        activated = _response(client.post(BASE + "/sessions/manual-takeover", json=takeover))
        assert activated["historyRecorded"] is True
        assert (
            _response(client.post(BASE + "/sessions/manual-takeover", json=takeover))["replayed"]
            is True
        )

        async def seed_unlinked_outcome_h2():
            db = Database(world["settings"].database_url)
            await db.open()
            try:
                async with db.engine.begin() as c:
                    await project_observations(
                        db,
                        c,
                        3,
                        [
                            {
                                "eventId": "equal-time-passive-h2",
                                **binding,
                                "source": "BOSS_PASSIVE_MESSAGE",
                                "observedAt": tied_at,
                                "messages": [
                                    {
                                        "messageId": "70002",
                                        "role": "HR",
                                        "text": "H2",
                                        "sentAt": tied_at,
                                        "deliveryState": "UNKNOWN",
                                    }
                                ],
                            }
                        ],
                    )
            finally:
                await db.close()

        asyncio.run(seed_unlinked_outcome_h2())
        with sqlite3.connect(world["path"]) as connection:
            assert connection.execute(
                "SELECT causal_after_message_id FROM conversation_message WHERE message_id='70002'"
            ).fetchone() == (None,)

        payload = {
            "requestId": "equal-time-reply-" + str(uuid4()),
            "kind": "REPLY",
            **binding,
            "input": {
                # Deliberately lower than the manual server MID: MID magnitude is not causality.
                "inboundMessageId": "70002",
                "inboundSentAt": tied_at,
                "question": "H2",
                "jobKey": "equal-time-job:boss-owner",
                "jobInfo": {},
                "exchangeRequest": None,
            },
        }
        job = _response(client.post(BASE + "/jobs", json=payload))
        claim = _response(
            client.post(
                "/internal/automation/claim",
                headers=INTERNAL,
                json={"workerId": "equal-time-worker"},
            )
        )
        lease = {key: claim[key] for key in ("leaseToken", "revision", "inputHash")}
        root = "/internal/automation/jobs/" + job["jobId"]
        _response(client.post(root + "/gather", headers=INTERNAL, json=lease))
        artifact = _response(client.post(root + "/compute", headers=INTERNAL, json=lease))
        commit = {**lease, "artifactId": artifact["artifactId"]}
        _response(client.post(root + "/validate", headers=INTERNAL, json=commit))
        _response(client.post(root + "/commit", headers=INTERNAL, json=commit))

        scope = {"executorId": "equal-time-executor", "platformAccount": "boss-owner"}
        _response(
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
        action = _response(
            client.post(BASE + "/actions/claim", json={**scope, "jobId": job["jobId"]})
        )
        dispatched = _response(
            client.post(
                BASE + "/actions/" + action["actionId"] + "/dispatch",
                json={
                    **scope,
                    "leaseToken": action["leaseToken"],
                    "authorizationRevision": action["authorizationRevision"],
                    "clientMid": "88001",
                },
            )
        )
        receipt = {
            **scope,
            "requestId": "equal-time-receipt-" + str(uuid4()),
            "dispatchToken": dispatched["dispatchToken"],
            "clientMid": "88001",
            "status": "ACKNOWLEDGED",
            # Deliberately lower again to prove the explicit edge controls the tie.
            "serverMid": "60003",
            "platformCode": 0,
            "occurredAt": tied_at,
            "errorCode": None,
        }
        path = BASE + "/actions/" + action["actionId"] + "/receipt"
        assert client.post(path, json=receipt).status_code == 200
        assert client.post(path, json=receipt).status_code == 200

    async def assert_frozen_chain():
        db = Database(world["settings"].database_url)
        await db.open()
        try:
            async with db.engine.begin() as c:
                for _ in range(10):
                    frozen = await freeze_recent(
                        db,
                        c,
                        3,
                        platform_account=binding["platformAccount"],
                        conversation_key=binding["conversationKey"],
                        boss_id=binding["bossId"],
                        encrypt_job_id=binding["encryptJobId"],
                    )
                    assert frozen["historyMessageIds"] == [
                        "81001",
                        "99002",
                        "70002",
                        "60003",
                    ]
                    assert frozen["historyCausalAfterMessageIds"] == [
                        None,
                        "81001",
                        "99002",
                        "70002",
                    ]
                    assert frozen["historyCausalDepths"] == [0, 1, 2, 3]
        finally:
            await db.close()

    asyncio.run(assert_frozen_chain())
    with sqlite3.connect(world["path"]) as connection:
        rows = connection.execute(
            "SELECT message_id,sent_at,order_at,causal_after_message_id,"
            "causal_root_message_id,causal_depth FROM conversation_message "
            "WHERE conversation_key='equal-time-conversation' ORDER BY causal_depth"
        ).fetchall()
    assert rows == [
        ("81001", first_at, first_at, None, "81001", 0),
        ("99002", tied_at, tied_at, "81001", "81001", 1),
        ("70002", tied_at, tied_at, "99002", "81001", 2),
        ("60003", None, tied_at, "70002", "81001", 3),
    ]


def test_next_reply_freezes_prior_manual_sequence_and_model_request_without_cross_talk(world):
    async def seed_other_conversation():
        db = Database(world["settings"].database_url)
        await db.open()
        try:
            async with db.engine.begin() as c:
                await append_manual_turn(
                    db,
                    c,
                    3,
                    platform_account="boss-owner",
                    conversation_key="different-conversation",
                    boss_id="different-peer",
                    encrypt_job_id="different-job",
                    inbound_message_id="93001",
                    inbound_sent_at=1_700_000_100_000,
                    inbound_text="不应进入当前上下文的HR消息",
                    outbound_message_id="93002",
                    outbound_client_mid="93003",
                    outbound_sent_at=1_700_000_100_100,
                    outbound_text="不应进入当前上下文的人工回复",
                    event_id="different-conversation-event",
                )
        finally:
            await db.close()

    asyncio.run(seed_other_conversation())
    settings = replace(
        world["settings"],
        automation_enabled=True,
        outcome_internal_token=INTERNAL_TOKEN,
    )
    world["fake"].output = "这是针对最新问题生成的回答。"
    base_time = int(time.time() * 1000) - 10_000
    with TestClient(create_app(settings, world["transport"])) as client:
        client.headers["Authorization"] = _response(
            client.post("/api/user/silently/login", params={"uniqueId": "boss-owner"})
        )
        takeover = {
            "requestId": "e2e-manual-" + str(uuid4()),
            "platformAccount": "boss-owner",
            "conversationKey": "e2e-conversation",
            "encryptJobId": "e2e-job",
            "bossId": "e2e-peer",
            "jobKey": "e2e-job:boss-owner",
            "throughInboundMessageId": "91001",
            "throughInboundSentAt": base_time,
            "throughInboundText": "上一轮HR问题",
            "manualOutboundClientMid": "92001",
            "manualOutboundMessageId": "92002",
            "manualOutboundSentAt": base_time + 100,
            "manualText": "上一轮人工回答",
        }
        activated = _response(client.post(BASE + "/sessions/manual-takeover", json=takeover))
        assert activated["historyRecorded"] is True

        current_question = "这是本轮新问题"
        job = _response(
            client.post(
                BASE + "/jobs",
                json={
                    "requestId": "e2e-reply-" + str(uuid4()),
                    "kind": "REPLY",
                    "platformAccount": "boss-owner",
                    "conversationKey": "e2e-conversation",
                    "bossId": "e2e-peer",
                    "encryptJobId": "e2e-job",
                    "input": {
                        "inboundMessageId": "91002",
                        "inboundSentAt": base_time + 200,
                        "question": current_question,
                        "jobKey": "e2e-job:boss-owner",
                        "jobInfo": {},
                        "exchangeRequest": None,
                    },
                },
            )
        )
        claim = _response(
            client.post(
                "/internal/automation/claim",
                headers=INTERNAL,
                json={"workerId": "e2e-worker"},
            )
        )
        assert claim["jobId"] == job["jobId"]
        with sqlite3.connect(world["path"]) as connection:
            context = json.loads(
                connection.execute(
                    "SELECT context_json FROM automation_job WHERE id=?", (job["jobId"],)
                ).fetchone()[0]
            )
        assert context["history"] == [
            {"role": "user", "content": "上一轮HR问题"},
            {"role": "assistant", "content": "上一轮人工回答"},
        ]
        assert context["historyMessageIds"] == ["91001", "92002"]
        assert "91002" not in context["historyMessageIds"]
        frozen_json = json.dumps(context, ensure_ascii=False)
        assert "不应进入当前上下文" not in frozen_json
        assert current_question not in frozen_json

        lease = {key: claim[key] for key in ("leaseToken", "revision", "inputHash")}
        root = "/internal/automation/jobs/" + job["jobId"]
        _response(client.post(root + "/gather", headers=INTERNAL, json=lease))
        _response(client.post(root + "/compute", headers=INTERNAL, json=lease))

    messages = world["fake"].calls[-1]["messages"]
    assert messages[-3:] == [
        {"role": "user", "content": "上一轮HR问题"},
        {"role": "assistant", "content": "上一轮人工回答"},
        {"role": "user", "content": current_question},
    ]
    assert sum(message.get("content") == current_question for message in messages) == 1
    assert "不应进入当前上下文" not in json.dumps(messages, ensure_ascii=False)
