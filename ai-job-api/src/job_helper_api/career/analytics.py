"""Deterministic application cohorts; no model arithmetic or inferred exposure."""

from collections import Counter, defaultdict

from ..database import loads, now_ms
from ..errors import ApiError
from .applications import Applications, effective_events

METRIC_VERSION = "career-cohort-v1"
DAY_MS = 86_400_000
CONFIRMED = {"OBSERVED", "USER_CONFIRMED"}
CONTACT_REASONS = (
    "immature",
    "unverifiedContact",
    "unknownExposure",
    "mixedExposure",
    "resumeVersionMismatch",
    "strategyPlanMismatch",
    "jobGroupMismatch",
    "missingJobGroup",
)


def validate_parameters(window_days, cutoff, resume_version_id, strategy_plan_id, job_group):
    if type(window_days) is not int or window_days not in {7, 14, 30}:
        raise ApiError("INVALID_COHORT_WINDOW", 422)
    if type(cutoff) is not int or cutoff <= 0:
        raise ApiError("INVALID_COHORT_CUTOFF", 422)
    for value in (resume_version_id, strategy_plan_id, job_group):
        if value is not None and (
            not isinstance(value, str) or not value.strip() or len(value) > 255
        ):
            raise ApiError("INVALID_COHORT_FILTER", 422)


def active_events(events, cutoff):
    # Unconfirmed/future corrections cannot remove confirmed facts. A confirmed
    # correction chain retires its predecessors, without reviving older links.
    eligible = [
        event
        for event in events
        if event["confirmation"] in CONFIRMED and 0 < event["occurred_at"] <= cutoff
    ]
    return sorted(effective_events(eligible), key=lambda event: (event["occurred_at"], event["id"]))


def actual_exposure(events, exposures):
    sent = {event["id"] for event in events if event["event_type"] == "RESUME_SENT"}
    by_event = defaultdict(list)
    for exposure in exposures:
        if exposure["event_id"] in sent:
            by_event[exposure["event_id"]].append(exposure)
    versions = set()
    unknown = not sent
    for event_id in sent:
        rows = by_event[event_id]
        unknown |= not rows
        for row in rows:
            if row["state"] == "VERIFIED" and row["resume_version_id"]:
                versions.add(row["resume_version_id"])
            else:
                unknown = True
    if not versions:
        return "UNKNOWN", None
    if unknown or len(versions) != 1:
        return "MIXED", None
    return "VERIFIED", next(iter(versions))


def exact_filter_reason(app, exposure, filters):
    if (
        filters["strategyPlanId"] is not None
        and app["strategy_plan_id"] != filters["strategyPlanId"]
    ):
        return "strategyPlanMismatch"
    if filters["jobGroup"] is not None:
        value = loads(app["data_json"], {})
        group = value.get("jobGroup") if isinstance(value, dict) else None
        if not isinstance(group, str) or not group:
            return "missingJobGroup"
        if group != filters["jobGroup"]:
            return "jobGroupMismatch"
    if filters["resumeVersionId"] is not None:
        state, version = exposure
        if state == "UNKNOWN":
            return "unknownExposure"
        if state == "MIXED":
            return "mixedExposure"
        if version != filters["resumeVersionId"]:
            return "resumeVersionMismatch"
    return None


def build_metric(cases, event_type, anchor_type, window_days, cutoff, filters):
    numerator, denominator = [], []
    excluded = defaultdict(list)
    horizon = window_days * DAY_MS
    for app, events, _, filter_reason in cases:
        ident = app["id"]
        anchors = [event["occurred_at"] for event in events if event["event_type"] == anchor_type]
        anchor = min(anchors) if anchors else None
        reason = filter_reason
        if reason is None and anchor is None:
            reason = (
                "unverifiedContact" if anchor_type == "CONTACT_INITIATED" else "unverifiedResume"
            )
        if reason is None and anchor + horizon > cutoff:
            reason = "immature" if anchor_type == "CONTACT_INITIATED" else "immatureResume"
        if reason is not None:
            excluded[reason].append(ident)
            continue
        denominator.append(ident)
        if any(
            event["event_type"] == event_type and anchor <= event["occurred_at"] <= anchor + horizon
            for event in events
        ):
            numerator.append(ident)
    excluded_ids = sorted(ident for ids in excluded.values() for ident in ids)
    return {
        "numerator": len(numerator),
        "denominator": len(denominator),
        "rate": len(numerator) / len(denominator) if denominator else None,
        "excludedCount": len(excluded_ids),
        "windowDays": window_days,
        "cutoff": cutoff,
        "metricVersion": METRIC_VERSION,
        "cohortFilters": dict(filters),
        "sampleIds": {
            "numerator": sorted(numerator),
            "denominator": sorted(denominator),
            "excluded": excluded_ids,
        },
        "excludedReasons": {reason: len(ids) for reason, ids in sorted(excluded.items())},
        "excludedSampleIdsByReason": {
            reason: sorted(ids) for reason, ids in sorted(excluded.items())
        },
    }


def cohort_metrics(
    applications,
    events,
    exposures,
    uid,
    *,
    window_days=14,
    cutoff,
    resume_version_id=None,
    strategy_plan_id=None,
    job_group=None,
):
    """Pure calculation over frozen raw rows, with owner/application binding.

    Counts outside rates cover every filter-matching application at cutoff,
    including immature cohorts. Metric excluded reasons are mutually exclusive
    per metric; later reports preserve this returned bundle rather than rerun it.
    """
    validate_parameters(window_days, cutoff, resume_version_id, strategy_plan_id, job_group)
    filters = {
        "resumeVersionId": resume_version_id,
        "strategyPlanId": strategy_plan_id,
        "jobGroup": job_group,
    }
    owned = sorted(
        (row for row in applications if row["user_id"] == uid), key=lambda row: row["id"]
    )
    by_event, by_exposure = defaultdict(list), defaultdict(list)
    for event in events:
        if event["user_id"] == uid:
            by_event[event["application_id"]].append(event)
    for exposure in exposures:
        if exposure["user_id"] == uid:
            by_exposure[exposure["application_id"]].append(exposure)
    cases = []
    for app in owned:
        active = active_events(by_event[app["id"]], cutoff)
        exposure = actual_exposure(active, by_exposure[app["id"]])
        cases.append((app, active, exposure, exact_filter_reason(app, exposure, filters)))
    metrics = {
        name: build_metric(cases, event_type, anchor, window_days, cutoff, filters)
        for name, event_type, anchor in (
            ("replyRate", "HR_REPLIED", "CONTACT_INITIATED"),
            ("interviewRate", "INTERVIEW_INVITED", "CONTACT_INITIATED"),
            ("offerRate", "OFFER_RECEIVED", "CONTACT_INITIATED"),
            ("resumeInterviewRate", "INTERVIEW_INVITED", "RESUME_SENT"),
        )
    }
    matched = [(app, active) for app, active, _, reason in cases if reason is None]
    progress_sample_ids = {
        "contacted": sorted(
            app["id"]
            for app, active in matched
            if any(event["event_type"] == "CONTACT_INITIATED" for event in active)
        ),
        "replied": sorted(
            app["id"]
            for app, active in matched
            if any(event["event_type"] == "HR_REPLIED" for event in active)
        ),
        "interviewed": sorted(
            app["id"]
            for app, active in matched
            if any(
                event["event_type"] in {"INTERVIEW_INVITED", "INTERVIEW_COMPLETED"}
                for event in active
            )
        ),
        "offers": sorted(
            app["id"]
            for app, active in matched
            if any(event["event_type"] == "OFFER_RECEIVED" for event in active)
        ),
    }
    progress_counts = {name: len(ids) for name, ids in progress_sample_ids.items()}
    withdrawn = sorted(
        app["id"]
        for app, active in matched
        if any(event["event_type"] == "WITHDRAWN" for event in active)
    )
    interviewed = sorted(
        app["id"]
        for app, active in matched
        if any(
            event["event_type"] in {"INTERVIEW_INVITED", "INTERVIEW_COMPLETED"} for event in active
        )
    )
    size = metrics["replyRate"]["denominator"]
    reason_counts = Counter(metrics["replyRate"]["excludedReasons"])
    uncertainties = [
        "仅反映已记录的关联，不作因果结论。",
        "迟到记录按发生时间归属；已保存报告保留生成时的固定数据。",
        "岗位类别、级别和投递渠道的可比性尚未核实；即使达到20个成熟样本，也仅作描述，不进行版本排名。",
    ]
    if size < 20:
        uncertainties.append("成熟联系样本少于20，不据此排名或判定策略优劣。")
    if any(exposure[0] != "VERIFIED" for _, _, exposure, _ in cases):
        uncertainties.append("准备或选择的简历不等于已发送；未知或混合附件版本不参与指定版本统计。")
    return {
        "metricVersion": METRIC_VERSION,
        "windowDays": window_days,
        "cutoff": cutoff,
        "cohortFilters": filters,
        "sampleSize": size,
        "descriptiveOnly": True,
        "noCausalClaim": True,
        "comparability": {
            "status": "UNVERIFIED",
            "sampleThresholdMet": size >= 20,
            "missingEvidence": ["verifiedJobFamily", "verifiedLevel", "verifiedChannel"],
        },
        "metrics": metrics,
        "progressCounts": progress_counts,
        "progressSampleIds": progress_sample_ids,
        "withdrawnCount": len(withdrawn),
        "everInterviewedCount": len(interviewed),
        "withdrawnSampleIds": withdrawn,
        "everInterviewedSampleIds": interviewed,
        "excludedCounts": {reason: reason_counts[reason] for reason in CONTACT_REASONS},
        "uncertainties": uncertainties,
    }


class Analytics(Applications):
    async def analytics(
        self,
        uid,
        window_days=14,
        cutoff=None,
        resume_version_id=None,
        strategy_plan_id=None,
        job_group=None,
        c=None,
    ):
        cutoff = now_ms() if cutoff is None else cutoff
        validate_parameters(window_days, cutoff, resume_version_id, strategy_plan_id, job_group)
        if cutoff > now_ms():
            raise ApiError("INVALID_COHORT_CUTOFF", 422)
        if c is None:
            # A supplied transaction is reused verbatim when freezing a review.
            # Read-only requests do not take the business mutation lock.
            async with self.db.engine.connect() as connection, connection.begin():
                return await self.analytics(
                    uid,
                    window_days,
                    cutoff,
                    resume_version_id,
                    strategy_plan_id,
                    job_group,
                    connection,
                )
        if resume_version_id is not None:
            await self.row(self.versions, uid, resume_version_id, c)
        if strategy_plan_id is not None:
            await self.row(self.strategies, uid, strategy_plan_id, c)
        return cohort_metrics(
            await self.owned_rows(self.applications, uid, c),
            await self.owned_rows(self.application_events, uid, c),
            await self.owned_rows(self.exposures, uid, c),
            uid,
            window_days=window_days,
            cutoff=cutoff,
            resume_version_id=resume_version_id,
            strategy_plan_id=strategy_plan_id,
            job_group=job_group,
        )
