import copy

import pytest
from test_outcomes import claim, ingest, observation, save
from test_outcomes import outcome_client as outcome_client

from job_helper_api.outcomes.contracts import Observation
from job_helper_api.outcomes.policy import (
    analysis_messages,
    material_key,
    merge_observation,
    project,
)

HOUR = 3_600_000
NOW = 1_800_000_000_000


def sent(*, stamp=NOW, state="UNREAD"):
    item = observation("这是我的简历，请您看看是否适合岗位？", role="USER", stamp=stamp)
    item["source"] = "BOSS_CONVERSATION_SNAPSHOT"
    item["messages"][0].update(deliveryState="ACKNOWLEDGED", sentAt=stamp)
    item["readEvidence"] = dict(
        messageId="server-1", state=state, source="BOSS_EXACT_MESSAGE_STATUS", observedAt=stamp
    )
    return item


def status(*, stamp=NOW, state="READ", event="read-event"):
    item = observation(event=event, stamp=stamp)
    item.update(
        source="BOSS_EXACT_MESSAGE_STATUS",
        messages=[],
        readEvidence=dict(
            messageId="server-1", state=state, source="BOSS_EXACT_MESSAGE_STATUS", observedAt=stamp
        ),
    )
    return item


def merged(item, facts=None, now=NOW):
    return merge_observation(facts or {}, Observation.model_validate(item), now)


@pytest.mark.parametrize("state,hours", [("READ", 24), ("UNREAD", 72)])
def test_no_reply_requires_real_coverage_after_exact_deadline(world, state, hours):
    settings = world["settings"]
    first = sent(state=state)
    facts = merged(first)
    deadline = NOW + hours * HOUR
    waiting = project(facts, settings, deadline - 1)
    assert waiting["nextCheckAt"] == deadline and waiting["outcome"] == "WAITING"
    offline = project(facts, settings, deadline)
    assert offline["outcome"] == "WAITING" and offline["processingStatus"] == "WAITING_OBSERVATION"
    snapshot = copy.deepcopy(first)
    snapshot.update(
        eventId="coverage",
        observedAt=deadline,
        bindingObservedAt=deadline,
        coverage=dict(
            anchorMessageId="server-1",
            latestMessageId="server-1",
            checkedAt=deadline,
            completeAfterAnchor=True,
        ),
    )
    covered = project(merged(snapshot, facts, deadline), settings, deadline)
    assert covered["outcome"] == "NO_REPLY" and covered["readState"] == state
    assert covered["asOf"] == deadline and covered["analysisKind"] == "FACTS_ONLY"
    snapshot.update(observedAt=deadline + 1000, bindingObservedAt=deadline + 1000)
    snapshot["coverage"]["checkedAt"] += 1000
    later = project(merged(snapshot, facts, deadline + 1000), settings, deadline + 1000)
    assert material_key(covered) == material_key(later)


def test_read_receipts_are_monotonic_and_use_earliest_credible_time(world):
    facts = merged(sent())
    facts = merged(status(stamp=NOW + 2 * HOUR), facts, NOW + 3 * HOUR)
    assert project(facts, world["settings"], NOW + 3 * HOUR)["nextCheckAt"] == NOW + 26 * HOUR
    facts = merged(status(stamp=NOW + 3 * HOUR), facts, NOW + 3 * HOUR)
    facts = merged(status(stamp=NOW + HOUR), facts, NOW + 3 * HOUR)
    facts = merged(status(stamp=NOW + 3 * HOUR, state="UNREAD"), facts, NOW + 3 * HOUR)
    result = project(facts, world["settings"], NOW + 3 * HOUR)
    assert result["readState"] == "READ" and result["nextCheckAt"] == NOW + 25 * HOUR


@pytest.mark.parametrize("missing", ["readEvidence", "sentAt", "ack"])
def test_incomplete_send_information_never_invents_unread_or_no_reply(world, missing):
    item = sent()
    if missing == "readEvidence":
        item["readEvidence"] = None
    elif missing == "sentAt":
        item["messages"][0]["sentAt"] = None
    else:
        item.update(readEvidence=None, source="BOSS_PASSIVE_MESSAGE")
        item["messages"][0]["deliveryState"] = "UNKNOWN"
    result = project(merged(item), world["settings"], NOW + 999 * HOUR)
    assert result["outcome"] == "WAITING" and result["nextCheckAt"] is None
    if missing != "sentAt":
        assert result["readState"] == "UNKNOWN"


@pytest.mark.parametrize(
    "text",
    [
        "暂时不安排面试",
        "还不能安排面试",
        "面试时间还没定",
        "面试安排另行通知",
        "如果明天安排面试方便吗？",
        "他问：‘来面试吗？’",
        "引用原话：明天来面试",
        "没有安排面试",
    ],
)
def test_negated_conditional_and_quoted_interview_is_not_positive(world, text):
    result = project(merged(observation(text, stamp=NOW)), world["settings"], NOW)
    assert result["outcome"] == "REPLIED"


def test_opposite_signals_without_real_time_are_unknown(world):
    first = observation("岗位已经招满了", stamp=NOW)
    first["messages"][0]["sentAt"] = None
    facts = merged(first)
    second = observation("明天来面试方便吗？", event="e2", message="m2", stamp=NOW + 1000)
    result = project(merged(second, facts, NOW + 1000), world["settings"], NOW + 1000)
    assert result["outcome"] == "UNKNOWN" and result["waitingOn"] == "UNKNOWN"


def test_rejection_courtesy_and_repeated_signal_do_not_reopen_confirmed_report(
    outcome_client, world
):
    client = outcome_client
    item = observation("这个岗位已经招满了。")
    case_id = ingest(client, item)["cases"][0]["caseId"]
    job = claim(client)
    _, report = save(client, job)
    assert (
        client.post(
            f"/api/job/outcomes/reports/{report['reportId']}/feedback",
            json={"requestId": "confirmed", "action": "CONFIRM"},
        ).status_code
        == 200
    )
    for index, text in enumerate(["好的", "谢谢", "祝你顺利", "这个岗位已经招满了。"]):
        ingest(
            client,
            observation(
                text,
                stamp=item["observedAt"] + index + 1,
                event=f"new-event-{index}",
                message=f"new-mid-{index}",
            ),
        )
    case = client.get(f"/api/job/outcomes/cases/{case_id}").json()["data"]
    assert case["revision"] == 1 and case["report"]["feedbackStatus"] == "CONFIRMED"
    assert case["outcome"] == "REJECTED" and len(world["fake"].calls) == 1


@pytest.mark.parametrize("text", ["好的", "收到", "谢谢"])
def test_positive_courtesy_ack_does_not_wait_for_hr_or_create_another_report(outcome_client, text):
    client = outcome_client
    first = observation()
    case_id = ingest(client, first)["cases"][0]["caseId"]
    save(client, claim(client))
    ingest(
        client,
        observation(
            text,
            role="USER",
            event="ack-courtesy",
            message="courtesy",
            stamp=first["observedAt"] + 10,
        ),
    )
    case = client.get(f"/api/job/outcomes/cases/{case_id}").json()["data"]
    assert case["revision"] == 1 and case["outcome"] == "POSITIVE" and case["waitingOn"] == "NONE"


def test_ack_alias_merges_echo_and_exact_status_references_existing_send(outcome_client):
    client = outcome_client
    item = observation("您好，请问岗位还在招聘吗？", role="USER", message="client:c1")
    item["messages"][0]["clientMessageId"] = "c1"
    case_id = ingest(client, item)["cases"][0]["caseId"]
    ack = copy.deepcopy(item)
    ack.update(eventId="ack", source="BOSS_SEND_ACK")
    ack["messages"][0].update(messageId="server-1", deliveryState="ACKNOWLEDGED")
    ingest(client, ack)
    ingest(client, status(stamp=item["observedAt"]))
    old_echo = copy.deepcopy(item)
    old_echo["eventId"] = "replayed-echo"
    ingest(client, old_echo)
    case = client.get(f"/api/job/outcomes/cases/{case_id}").json()["data"]
    assert case["readState"] == "READ"
    ack["eventId"] = "forged-alias"
    ack["messages"][0]["messageId"] = "other-server-id"
    assert (
        client.post(
            "/api/job/outcomes/observations", json={"schemaVersion": 1, "observations": [ack]}
        ).status_code
        == 409
    )


def test_empty_observation_and_untrusted_ack_are_rejected(outcome_client):
    item = observation()
    item["messages"] = []
    for source in ("BOSS_PASSIVE_MESSAGE", "BOSS_EXACT_MESSAGE_STATUS"):
        item["source"] = source
        assert (
            outcome_client.post(
                "/api/job/outcomes/observations", json={"schemaVersion": 1, "observations": [item]}
            ).status_code
            == 422
        )
    item = sent(stamp=1)
    item["source"] = "BOSS_EXACT_MESSAGE_STATUS"
    assert (
        outcome_client.post(
            "/api/job/outcomes/observations", json={"schemaVersion": 1, "observations": [item]}
        ).status_code
        == 422
    )


def test_later_verified_binding_preserves_original_observation_time_and_identity(outcome_client):
    item = observation()
    item["bindingObservedAt"] = item["observedAt"] + 10_000
    result = ingest(outcome_client, item)
    job = claim(outcome_client)
    assert job["context"]["asOf"] == item["observedAt"]
    assert ingest(outcome_client, item)["duplicateEventIds"] == [item["eventId"]]
    assert result["cases"][0]["revision"] == 1


def test_long_courtesy_exchange_preserves_material_rejection(world):
    facts = merged(observation("岗位已经招满了", stamp=NOW))
    initial = project(facts, world["settings"], NOW)
    facts["projection"] = initial
    for index in range(205):
        facts = merged(
            observation("谢谢", stamp=NOW + index + 1, event=f"e{index}", message=f"m{index}"),
            facts,
            NOW + 1000,
        )
        facts["projection"] = project(facts, world["settings"], NOW + 1000)
    assert len(facts["messages"]) <= 200
    assert material_key(facts["projection"]) == material_key(initial)
    selected = analysis_messages({"facts": facts, "projection": facts["projection"]})
    assert len(selected) <= 40 and any(m["text"] == "岗位已经招满了" for m in selected)


def test_user_courtesy_ack_and_read_after_rejection_do_not_reopen_analysis(outcome_client, world):
    client = outcome_client
    first = observation("岗位已经招满了")
    case_id = ingest(client, first)["cases"][0]["caseId"]
    save(client, claim(client))
    item = observation(
        "谢谢",
        role="USER",
        event="courtesy-echo",
        message="client:thanks",
        stamp=first["observedAt"] + 1,
    )
    item["messages"][0]["clientMessageId"] = "thanks"
    ingest(client, item)
    item.update(eventId="courtesy-ack", source="BOSS_SEND_ACK")
    item["messages"][0].update(messageId="server-thanks", deliveryState="ACKNOWLEDGED")
    ingest(client, item)
    reading = status(stamp=item["observedAt"])
    reading["readEvidence"]["messageId"] = "server-thanks"
    ingest(client, reading)
    case = client.get(f"/api/job/outcomes/cases/{case_id}").json()["data"]
    assert case["revision"] == 1 and case["outcome"] == "REJECTED" and case["waitingOn"] == "NONE"
    assert len(world["fake"].calls) == 1
