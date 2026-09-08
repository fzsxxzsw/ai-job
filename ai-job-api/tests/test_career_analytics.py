import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace

import pytest
from sqlalchemy import MetaData, select

from job_helper_api.automation.schema import automation_metadata
from job_helper_api.career.analytics import Analytics, cohort_metrics
from job_helper_api.career.schema import career_metadata
from job_helper_api.database import Database
from job_helper_api.errors import ApiError

DAY = 86_400_000
START = 1_700_000_000_000
CUTOFF = START + 30 * DAY


def application(ident="app", uid=3, *, prepared=None, strategy=None, group="engineering"):
    return {
        "id": ident,
        "user_id": uid,
        "application_key": f"key-{ident}",
        "platform_account": f"account-{uid}",
        "encrypt_job_id": f"job-{ident}",
        "conversation_key": None,
        "boss_id": None,
        "cycle_key": "round-1",
        "job_id": None,
        "prepared_resume_version_id": prepared,
        "strategy_plan_id": strategy,
        "contacted_at": START,
        "data_json": json.dumps({"jobGroup": group}),
        "legacy_snapshot_id": None,
        "created_at": START,
    }


def event(
    kind,
    day=0,
    *,
    ident=None,
    confirmation="OBSERVED",
    supersedes=None,
    created_day=0,
    app="app",
    uid=3,
    offset=0,
):
    return {
        "id": ident or f"{kind}-{day}-{offset}",
        "user_id": uid,
        "application_id": app,
        "event_type": kind,
        "occurred_at": START + day * DAY + offset,
        "confirmation": confirmation,
        "evidence_json": "{}",
        "supersedes_event_id": supersedes,
        "created_at": START + created_day * DAY,
    }


def exposure(event_id, version="v1", state="VERIFIED", *, app="app", uid=3):
    return {
        "id": f"exposure-{event_id}",
        "user_id": uid,
        "application_id": app,
        "event_id": event_id,
        "resume_version_id": version,
        "state": state,
        "verification_kind": "USER_CONFIRMED",
        "platform_resume_id": "attachment-1",
        "created_at": START,
    }


def result(events, *, apps=None, exposures=None, **filters):
    return cohort_metrics(
        apps or [application()], events, exposures or [], 3, cutoff=CUTOFF, **filters
    )


# Hand-authored expected counts, including contradictory and late evidence.
# Tuple: contact denominator, reply, invite, offer, resume denominator, resume invite, ever interviewed, withdrawn.
CASES = [
    (
        "explicit-reply",
        [event("CONTACT_INITIATED"), event("HR_REPLIED", 1)],
        (1, 1, 0, 0, 0, 0, 0, 0),
    ),
    (
        "invite-then-reject",
        [event("CONTACT_INITIATED"), event("INTERVIEW_INVITED", 5), event("REJECTED", 8)],
        (1, 0, 1, 0, 0, 0, 1, 0),
    ),
    (
        "completed-without-invite-record",
        [event("CONTACT_INITIATED"), event("INTERVIEW_COMPLETED", 5)],
        (1, 0, 0, 0, 0, 0, 1, 0),
    ),
    ("offer", [event("CONTACT_INITIATED"), event("OFFER_RECEIVED", 7)], (1, 0, 0, 1, 0, 0, 0, 0)),
    (
        "withdrawal-stays-in-cohort",
        [event("CONTACT_INITIATED"), event("WITHDRAWN", 2), event("HR_REPLIED", 3)],
        (1, 1, 0, 0, 0, 0, 0, 1),
    ),
    ("mature-no-recorded-response", [event("CONTACT_INITIATED")], (1, 0, 0, 0, 0, 0, 0, 0)),
    ("13-day-contact", [event("CONTACT_INITIATED", 17)], (0, 0, 0, 0, 0, 0, 0, 0)),
    ("exact-maturity", [event("CONTACT_INITIATED", 16)], (1, 0, 0, 0, 0, 0, 0, 0)),
    ("one-ms-immature", [event("CONTACT_INITIATED", 16, offset=1)], (0, 0, 0, 0, 0, 0, 0, 0)),
    ("missing-contact", [event("HR_REPLIED", 1)], (0, 0, 0, 0, 0, 0, 0, 0)),
    (
        "inferred-contact",
        [event("CONTACT_INITIATED", confirmation="INFERRED"), event("HR_REPLIED", 1)],
        (0, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "inferred-reply",
        [event("CONTACT_INITIATED"), event("HR_REPLIED", 1, confirmation="INFERRED")],
        (1, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "future-reply",
        [event("CONTACT_INITIATED"), event("HR_REPLIED", 30, offset=1)],
        (1, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "late-arriving-reply",
        [event("CONTACT_INITIATED"), event("HR_REPLIED", 2, created_day=40)],
        (1, 1, 0, 0, 0, 0, 0, 0),
    ),
    (
        "reply-before-contact",
        [event("CONTACT_INITIATED"), event("HR_REPLIED", -1)],
        (1, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "reply-exact-horizon",
        [event("CONTACT_INITIATED"), event("HR_REPLIED", 14)],
        (1, 1, 0, 0, 0, 0, 0, 0),
    ),
    (
        "reply-one-ms-late",
        [event("CONTACT_INITIATED"), event("HR_REPLIED", 14, offset=1)],
        (1, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "late-invite-ever-retained",
        [event("CONTACT_INITIATED"), event("INTERVIEW_INVITED", 15)],
        (1, 0, 0, 0, 0, 0, 1, 0),
    ),
    (
        "invite-exact-cutoff",
        [event("CONTACT_INITIATED"), event("INTERVIEW_INVITED", 30)],
        (1, 0, 0, 0, 0, 0, 1, 0),
    ),
    (
        "future-invite",
        [event("CONTACT_INITIATED"), event("INTERVIEW_INVITED", 30, offset=1)],
        (1, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "corrected-away-reply",
        [
            event("CONTACT_INITIATED"),
            event("HR_REPLIED", 2, ident="r"),
            event("CORRECTION", 4, supersedes="r"),
        ],
        (1, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "future-correction",
        [
            event("CONTACT_INITIATED"),
            event("HR_REPLIED", 2, ident="r"),
            event("CORRECTION", 31, supersedes="r"),
        ],
        (1, 1, 0, 0, 0, 0, 0, 0),
    ),
    (
        "unconfirmed-correction",
        [
            event("CONTACT_INITIATED"),
            event("HR_REPLIED", 2, ident="r"),
            event("CORRECTION", 4, supersedes="r", confirmation="INFERRED"),
        ],
        (1, 1, 0, 0, 0, 0, 0, 0),
    ),
    (
        "corrected-reply-time",
        [
            event("CONTACT_INITIATED"),
            event("HR_REPLIED", 20, ident="r"),
            event("HR_REPLIED", 3, supersedes="r"),
        ],
        (1, 1, 0, 0, 0, 0, 0, 0),
    ),
    (
        "correction-chain",
        [
            event("CONTACT_INITIATED"),
            event("HR_REPLIED", 2, ident="r"),
            event("CORRECTION", 3, ident="c", supersedes="r"),
            event("HR_REPLIED", 4, supersedes="c"),
        ],
        (1, 1, 0, 0, 0, 0, 0, 0),
    ),
    (
        "repeat-replies-one-person",
        [event("CONTACT_INITIATED"), event("HR_REPLIED", 1), event("HR_REPLIED", 2)],
        (1, 1, 0, 0, 0, 0, 0, 0),
    ),
    (
        "repeat-contact-no-window-reset",
        [event("CONTACT_INITIATED"), event("CONTACT_INITIATED", 12), event("HR_REPLIED", 20)],
        (1, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "corrected-contact-changes-maturity",
        [
            event("CONTACT_INITIATED", ident="c"),
            event("CONTACT_INITIATED", 20, supersedes="c"),
            event("HR_REPLIED", 21),
        ],
        (0, 0, 0, 0, 0, 0, 0, 0),
    ),
    (
        "confirmed-resume-to-invite",
        [
            event("CONTACT_INITIATED"),
            event("RESUME_SENT", 3, confirmation="USER_CONFIRMED"),
            event("INTERVIEW_INVITED", 14),
        ],
        (1, 0, 1, 0, 1, 1, 1, 0),
    ),
    (
        "resume-immature",
        [event("CONTACT_INITIATED"), event("RESUME_SENT", 20), event("INTERVIEW_INVITED", 25)],
        (1, 0, 0, 0, 0, 0, 1, 0),
    ),
    (
        "resume-exact-horizon",
        [event("CONTACT_INITIATED"), event("RESUME_SENT", 16), event("INTERVIEW_INVITED", 30)],
        (1, 0, 0, 0, 1, 1, 1, 0),
    ),
    (
        "inferred-resume",
        [
            event("CONTACT_INITIATED"),
            event("RESUME_SENT", 1, confirmation="INFERRED"),
            event("INTERVIEW_INVITED", 5),
        ],
        (1, 0, 1, 0, 0, 0, 1, 0),
    ),
    (
        "resume-without-contact-record",
        [event("RESUME_SENT"), event("INTERVIEW_INVITED", 5)],
        (0, 0, 0, 0, 1, 1, 1, 0),
    ),
    (
        "invite-before-resume",
        [event("CONTACT_INITIATED"), event("RESUME_SENT", 4), event("INTERVIEW_INVITED", 1)],
        (1, 0, 1, 0, 1, 0, 1, 0),
    ),
    (
        "invite-after-resume-horizon",
        [event("CONTACT_INITIATED"), event("RESUME_SENT", 1), event("INTERVIEW_INVITED", 16)],
        (1, 0, 0, 0, 1, 0, 1, 0),
    ),
    (
        "immature-ever-interviewed-withdrawn",
        [
            event("CONTACT_INITIATED", 25),
            event("INTERVIEW_INVITED", 26),
            event("WITHDRAWN", 27),
            event("REJECTED", 28),
        ],
        (0, 0, 0, 0, 0, 0, 1, 1),
    ),
]


@pytest.mark.parametrize("name,events,expected", CASES, ids=[case[0] for case in CASES])
def test_synthetic_history_examples(name, events, expected):
    actual = result(events)
    metrics = actual["metrics"]
    assert (
        metrics["replyRate"]["denominator"],
        metrics["replyRate"]["numerator"],
        metrics["interviewRate"]["numerator"],
        metrics["offerRate"]["numerator"],
        metrics["resumeInterviewRate"]["denominator"],
        metrics["resumeInterviewRate"]["numerator"],
        actual["everInterviewedCount"],
        actual["withdrawnCount"],
    ) == expected
    assert actual["noCausalClaim"] and actual["descriptiveOnly"]
    for metric in metrics.values():
        assert metric["rate"] == (float(metric["numerator"]) if metric["denominator"] else None)
        assert metric["numerator"] == len(metric["sampleIds"]["numerator"])
        assert metric["denominator"] + metric["excludedCount"] == 1


@pytest.mark.parametrize("days", [7, 14, 30])
def test_supported_horizons_include_exact_boundary_and_exclude_one_millisecond_after(days):
    contacts = [event("CONTACT_INITIATED", app="inside"), event("CONTACT_INITIATED", app="outside")]
    replies = [
        event("HR_REPLIED", days, app="inside"),
        event("HR_REPLIED", days, app="outside", offset=1),
    ]
    actual = result(
        contacts + replies, apps=[application("inside"), application("outside")], window_days=days
    )
    metric = actual["metrics"]["replyRate"]
    assert metric["numerator"] == 1 and metric["denominator"] == 2 and metric["rate"] == 0.5
    assert metric["sampleIds"]["numerator"] == ["inside"]


@pytest.mark.parametrize(
    "correction",
    [
        event("CORRECTION", 31, supersedes="contact"),
        event("CORRECTION", 1, supersedes="contact", confirmation="INFERRED"),
    ],
)
def test_future_or_unconfirmed_correction_cannot_retire_a_contact_anchor(correction):
    metric = result([event("CONTACT_INITIATED", ident="contact"), event("HR_REPLIED"), correction])[
        "metrics"
    ]["replyRate"]
    # A reply at exactly the contact timestamp is within [contact, contact + H].
    assert metric["denominator"] == metric["numerator"] == 1


@pytest.mark.parametrize("size", [0, 19, 20, 30])
def test_sample_threshold_does_not_establish_comparability_or_causality(size):
    apps = [application(str(i)) for i in range(size)]
    events = [event("CONTACT_INITIATED", app=str(i)) for i in range(size)]
    actual = cohort_metrics(apps, events, [], 3, cutoff=CUTOFF)
    assert actual["sampleSize"] == size and actual["descriptiveOnly"] is True
    assert actual["comparability"]["status"] == "UNVERIFIED"
    assert actual["comparability"]["sampleThresholdMet"] is (size >= 20)
    assert actual["noCausalClaim"] is True
    assert actual["metrics"]["replyRate"]["rate"] == (0 if size else None)
    assert actual["progressCounts"]["contacted"] == size


def test_progress_counts_include_real_immature_results_without_changing_rates():
    actual = result(
        [
            event("CONTACT_INITIATED", 25),
            event("HR_REPLIED", 26),
            event("INTERVIEW_INVITED", 27),
            event("OFFER_RECEIVED", 28),
        ]
    )
    assert actual["sampleSize"] == 0
    assert actual["metrics"]["replyRate"]["rate"] is None
    assert actual["progressCounts"] == {
        "contacted": 1,
        "replied": 1,
        "interviewed": 1,
        "offers": 1,
    }
    assert actual["progressSampleIds"] == {
        "contacted": ["app"],
        "replied": ["app"],
        "interviewed": ["app"],
        "offers": ["app"],
    }


@pytest.mark.parametrize(
    "sent,proofs,reason",
    [
        ([event("RESUME_SENT", 1, ident="s")], [exposure("s")], None),
        ([event("RESUME_SENT", 1, ident="s")], [exposure("s", None, "UNKNOWN")], "unknownExposure"),
        (
            [event("RESUME_SENT", 1, ident="s", confirmation="INFERRED")],
            [exposure("s")],
            "unknownExposure",
        ),
        ([], [exposure("not-a-send")], "unknownExposure"),
        (
            [event("RESUME_SENT", 1, ident="s"), event("RESUME_SENT", 2, ident="t")],
            [exposure("s"), exposure("t", None, "UNKNOWN")],
            "mixedExposure",
        ),
        (
            [event("RESUME_SENT", 1, ident="s"), event("RESUME_SENT", 2, ident="t")],
            [exposure("s"), exposure("t", "v2")],
            "mixedExposure",
        ),
        (
            [event("RESUME_SENT", 1, ident="s"), event("RESUME_SENT", 2, ident="t")],
            [exposure("s"), exposure("t")],
            None,
        ),
        (
            [event("RESUME_SENT", 1, ident="s"), event("RESUME_SENT", 31, ident="t")],
            [exposure("s"), exposure("t", None, "UNKNOWN")],
            None,
        ),
        (
            [
                event("RESUME_SENT", 1, ident="s"),
                event("RESUME_SENT", 2, ident="t"),
                event("CORRECTION", 3, supersedes="t"),
            ],
            [exposure("s"), exposure("t", None, "UNKNOWN")],
            None,
        ),
        ([event("RESUME_SENT", 1, ident="s")], [exposure("s", uid=9)], "unknownExposure"),
        ([event("RESUME_SENT", 1, ident="s")], [exposure("s", app="other-app")], "unknownExposure"),
        ([event("RESUME_SENT", 1, ident="s")], [exposure("s", "v2")], "resumeVersionMismatch"),
        (
            [event("RESUME_SENT", 1, ident="s"), event("RESUME_SENT", 2, ident="t")],
            [exposure("s")],
            "mixedExposure",
        ),
    ],
)
def test_only_proven_actual_attachment_versions_enter_specific_cohorts(sent, proofs, reason):
    events = [event("CONTACT_INITIATED"), event("HR_REPLIED", 5), *sent]
    actual = result(
        events, apps=[application(prepared="v1")], exposures=proofs, resume_version_id="v1"
    )
    metric = actual["metrics"]["replyRate"]
    assert metric["denominator"] == (1 if reason is None else 0)
    assert metric["excludedReasons"] == ({} if reason is None else {reason: 1})
    # Unknown exposure does not erase general application-level response rates.
    assert result(events, exposures=proofs)["metrics"]["replyRate"]["denominator"] == 1


def test_filtering_is_exact_and_exclusion_drilldown_is_complete():
    apps = [
        application("match", strategy="plan"),
        application("case", strategy="Plan"),
        application("group", strategy="plan", group="Engineering"),
        application("missing", strategy="plan", group=None),
    ]
    events = [event("CONTACT_INITIATED", app=app["id"]) for app in apps]
    actual = result(events, apps=apps, strategy_plan_id="plan", job_group="engineering")
    metric = actual["metrics"]["replyRate"]
    assert metric["sampleIds"] == {
        "numerator": [],
        "denominator": ["match"],
        "excluded": ["case", "group", "missing"],
    }
    assert metric["excludedReasons"] == {
        "jobGroupMismatch": 1,
        "missingJobGroup": 1,
        "strategyPlanMismatch": 1,
    }
    assert metric["excludedSampleIdsByReason"] == {
        "jobGroupMismatch": ["group"],
        "missingJobGroup": ["missing"],
        "strategyPlanMismatch": ["case"],
    }


def test_owner_application_and_correction_binding_prevent_cross_user_leaks():
    apps = [application(), application("private", uid=9)]
    events = [
        event("CONTACT_INITIATED"),
        event("HR_REPLIED", 1, ident="reply"),
        event("CORRECTION", 2, supersedes="reply", uid=9),
        event("CORRECTION", 3, supersedes="reply", app="private"),
        event("INTERVIEW_INVITED", 2, uid=9),
        event("CONTACT_INITIATED", app="private", uid=9),
    ]
    actual = result(events, apps=apps)
    assert actual["metrics"]["replyRate"]["numerator"] == 1
    assert actual["everInterviewedCount"] == 0
    assert "private" not in json.dumps(actual)


def test_shuffled_rows_repeat_exactly_and_saved_bundle_is_immutable():
    apps, events = [], []
    for index, (_, history, _) in enumerate(CASES):
        ident = f"case-{index:02d}"
        apps.append(application(ident))
        for original in history:
            value = {**original, "application_id": ident}
            events.append(value)
    first = result(events, apps=apps)
    snapshot = deepcopy(first)
    assert result(list(reversed(events)), apps=list(reversed(apps))) == first
    assert first["metrics"]["replyRate"]["denominator"] == sum(case[2][0] for case in CASES)
    assert first["metrics"]["replyRate"]["numerator"] == sum(case[2][1] for case in CASES)
    events.append(event("OFFER_RECEIVED", 1, app="case-00"))
    result(events, apps=apps)
    assert first == snapshot


@pytest.mark.parametrize(
    "kwargs",
    [
        {"window_days": 1},
        {"window_days": 14.0},
        {"window_days": True},
        {"cutoff": 0},
        {"cutoff": True},
        {"job_group": " "},
        {"resume_version_id": 1},
        {"strategy_plan_id": ""},
    ],
)
def test_invalid_cohort_parameters_fail_explicitly(kwargs):
    params = {"cutoff": CUTOFF, **kwargs}
    with pytest.raises(ApiError):
        cohort_metrics([], [], [], 3, **params)


def test_sqlite_adapter_uses_supplied_transaction_and_filters_owned_ids(tmp_path):
    async def scenario():
        db = Database("sqlite+aiosqlite:///" + (tmp_path / "analytics.sqlite3").as_posix())
        metadata = MetaData()
        for source in (career_metadata(), automation_metadata()):
            for table in source.tables.values():
                table.to_metadata(metadata)
        db.metadata, db.ready = metadata, True
        try:
            async with db.engine.begin() as c:
                await c.run_sync(metadata.create_all)
            service = Analytics(db, SimpleNamespace(owner_user_id=3, read_only=True))
            async with db.engine.begin() as c:
                await c.execute(
                    service.applications.insert(), [application(), application("private", uid=9)]
                )
                await c.execute(
                    service.application_events.insert(),
                    [
                        event("CONTACT_INITIATED"),
                        event("HR_REPLIED", 2),
                        event("CONTACT_INITIATED", ident="private-contact", app="private", uid=9),
                    ],
                )
                await c.execute(
                    service.versions.insert(),
                    [
                        dict(
                            id="V1",
                            user_id=3,
                            parent_id=None,
                            source="USER_TEXT",
                            content_hash="a" * 64,
                            data_json="{}",
                            created_at=START,
                        ),
                        dict(
                            id="private-version",
                            user_id=9,
                            parent_id=None,
                            source="USER_TEXT",
                            content_hash="b" * 64,
                            data_json="{}",
                            created_at=START,
                        ),
                    ],
                )
                # Uncommitted rows are visible only through this supplied transaction.
                bundle = await service.analytics(3, cutoff=CUTOFF, c=c)
                assert bundle["sampleSize"] == 1 and bundle["metrics"]["replyRate"]["rate"] == 1
                for version in ("v1", "private-version"):
                    with pytest.raises(ApiError) as error:
                        await service.analytics(3, cutoff=CUTOFF, resume_version_id=version, c=c)
                    assert error.value.code == 404
                assert (await service.analytics(3, cutoff=CUTOFF, resume_version_id="V1", c=c))[
                    "sampleSize"
                ] == 0
            assert await service.analytics(3, cutoff=CUTOFF) == bundle
            # Analytics is read-only, including when the service is read_only=True.
            async with db.engine.connect() as c:
                assert len((await c.execute(select(service.application_events))).all()) == 3
        finally:
            await db.engine.dispose()

    asyncio.run(scenario())
