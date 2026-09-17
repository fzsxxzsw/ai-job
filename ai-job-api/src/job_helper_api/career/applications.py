from sqlalchemy import func, select

from ..application_validity import validity_columns
from ..automation.conversation_history import conversation_id
from ..automation.storage import digest, identifier
from ..database import dumps, loads, now_ms
from ..errors import ApiError
from .versions import Versions, content_hash

ORIGIN_PRIORITY = {"UNKNOWN": 0, "LEGACY_IMPORT": 1, "MANUAL_DISCOVERED": 2, "ASSISTANT": 3}
STATUS_PRIORITY = {
    "DISCOVERED": 10,
    "APPLIED": 20,
    "UNREAD": 30,
    "READ": 40,
    "HR_REPLIED": 50,
    "SOFT_REJECTED": 60,
    "WITHDRAWN": 80,
    "EXPLICIT_REJECTED": 90,
    "INTERVIEW_SCHEDULED": 90,
    "OFFER_RECEIVED": 100,
}
NORMALIZED_FIELDS = (
    ("job_title", "jobTitle", 255),
    ("company_name", "companyName", 255),
    ("recruiter_name", "recruiterName", 255),
    ("salary_text", "salaryText", 255),
    ("location_text", "locationText", 500),
    ("jd_text", "jdText", 60000),
)


def _text(value, limit):
    cleaned = str(value or "").strip()
    return cleaned[:limit] or None


def _snapshot_data(data, origin, source, observed_at):
    value = dict(data) if isinstance(data, dict) else {}
    base = loads(value.get("jobBaseInfo"), {})
    ext = loads(value.get("jobExtInfo"), {})
    base = base if isinstance(base, dict) else {}
    ext = ext if isinstance(ext, dict) else {}
    location = " ".join(
        dict.fromkeys(
            part
            for part in (
                _text(base.get("cityName"), 120),
                _text(base.get("areaDistrict"), 120),
                _text(base.get("businessDistrict"), 120),
                _text(ext.get("address"), 300),
            )
            if part
        )
    )
    fallbacks = {
        "jobTitle": value.get("jobTitle") or base.get("jobName") or base.get("jobTitle"),
        "companyName": value.get("companyName") or base.get("brandName") or base.get("companyName"),
        "recruiterName": value.get("recruiterName"),
        "salaryText": value.get("salaryText") or base.get("salaryDesc") or base.get("salary"),
        "locationText": value.get("locationText") or location,
        "jdText": value.get("jdText")
        or ext.get("postDescription")
        or ext.get("jobDescription")
        or ext.get("description"),
    }
    normalized = {}
    for column, key, limit in NORMALIZED_FIELDS:
        normalized[column] = _text(fallbacks[key], limit)
        if normalized[column]:
            value[key] = normalized[column]
    missing = [key for column, key, _ in NORMALIZED_FIELDS if not normalized[column]]
    value.update(
        origin=origin,
        snapshotCompleteness="COMPLETE" if not missing else "PARTIAL",
        missingFields=missing,
    )
    sources = value.get("snapshotSources")
    if not isinstance(sources, list):
        sources = []
    entry = {"origin": origin, "source": source or origin, "observedAt": observed_at}
    if entry not in sources:
        sources.append(entry)
    value["snapshotSources"] = sources[-20:]
    return normalized, value


def _merge_snapshot(existing, incoming, existing_origin, incoming_origin, source, observed_at):
    current = loads(existing, {})
    current = current if isinstance(current, dict) else {}
    incoming = dict(incoming) if isinstance(incoming, dict) else {}
    prefer_incoming = ORIGIN_PRIORITY.get(incoming_origin, 0) >= ORIGIN_PRIORITY.get(
        existing_origin, 0
    )
    for key, value in incoming.items():
        if value in (None, "", [], {}):
            continue
        if prefer_incoming or current.get(key) in (None, "", [], {}):
            current[key] = value
    origin = (
        incoming_origin
        if ORIGIN_PRIORITY.get(incoming_origin, 0) > ORIGIN_PRIORITY.get(existing_origin, 0)
        else existing_origin
    )
    return origin, _snapshot_data(current, origin, source, observed_at)


def effective_events(events):
    removed = {row["supersedes_event_id"] for row in events if row["supersedes_event_id"]}
    return [row for row in events if row["id"] not in removed]


class Applications(Versions):
    async def validity_values(self, c, uid, snapshot, *, observed_at, source):
        owner = await self.db.user(uid, c)
        return validity_columns(
            snapshot,
            (owner or {}).get("preference"),
            observed_at=observed_at,
            source=source or "APPLICATION_LEDGER",
        )

    async def refresh_application_validity(
        self, c, uid, app, *, observed_at=None, source="APPLICATION_LEDGER_RECLASSIFY"
    ):
        evaluated_at = observed_at or now_ms()
        values = await self.validity_values(
            c,
            uid,
            self.json_value(app),
            observed_at=evaluated_at,
            source=source,
        )
        values["updated_at"] = max(app.get("updated_at") or 0, evaluated_at)
        await c.execute(
            self.applications.update()
            .where(self.applications.c.id == app["id"], self.applications.c.user_id == uid)
            .values(**values)
        )
        return {**app, **values}

    def event_view(self, row):
        return {
            "eventId": row["id"],
            "eventType": row["event_type"],
            "occurredAt": row["occurred_at"],
            "confirmation": row["confirmation"],
            "evidence": loads(row["evidence_json"], {}),
            "supersedesEventId": row["supersedes_event_id"],
            "createdAt": row["created_at"],
        }

    async def timeline(self, uid, app_id, c=None):
        return sorted(
            await self.owned_rows(
                self.application_events, uid, c, self.application_events.c.application_id == app_id
            ),
            key=lambda row: (row["occurred_at"], row["created_at"], row["id"]),
        )

    async def exposure(self, uid, app_id, events, c=None):
        valid_ids = {
            row["id"]
            for row in effective_events([e for e in events if e["confirmation"] != "INFERRED"])
        }
        rows = [
            r
            for r in await self.owned_rows(
                self.exposures, uid, c, self.exposures.c.application_id == app_id
            )
            if r["event_id"] in valid_ids
        ]
        ids = {r["resume_version_id"] for r in rows if r["state"] == "VERIFIED"}
        unknown = any(r["state"] != "VERIFIED" for r in rows)
        state = "UNKNOWN" if not ids else "MIXED" if unknown or len(ids) != 1 else "VERIFIED"
        return {
            "state": state,
            "resumeVersionId": next(iter(ids)) if state == "VERIFIED" else None,
            "verificationKind": next(
                (r["verification_kind"] for r in rows if r["state"] == "VERIFIED"), None
            )
            if state == "VERIFIED"
            else None,
        }

    async def application_view(self, uid, row, c=None, detail=False):
        events = await self.timeline(uid, row["id"], c)
        confirmed = effective_events(
            [event for event in events if event["confirmation"] != "INFERRED"]
        )
        contacts = [
            event["occurred_at"]
            for event in confirmed
            if event["event_type"] == "CONTACT_INITIATED"
        ]
        value = self.json_value(row)
        stages = {
            "CONTACT_INITIATED": 1,
            "HR_REPLIED": 2,
            "INTERVIEW_INVITED": 3,
            "INTERVIEW_COMPLETED": 4,
            "OFFER_RECEIVED": 5,
        }
        reached = [event["event_type"] for event in confirmed if event["event_type"] in stages]
        stage = max(reached, key=stages.get) if reached else "UNKNOWN"
        outcomes = [
            event["event_type"]
            for event in confirmed
            if event["event_type"] in {"REJECTED", "OFFER_RECEIVED", "WITHDRAWN"}
        ]
        result = {
            "applicationId": row["id"],
            "origin": row["origin"],
            "platformAccount": row["platform_account"],
            "encryptJobId": row["encrypt_job_id"],
            "conversationKey": row["conversation_key"],
            "bossId": row["boss_id"],
            "cycleKey": row["cycle_key"],
            "jobTitle": row["job_title"] or value.get("jobTitle", ""),
            "companyName": row["company_name"],
            "recruiterName": row["recruiter_name"],
            "salaryText": row["salary_text"],
            "locationText": row["location_text"],
            "snapshotCompleteness": row["snapshot_completeness"],
            "missingFields": value.get("missingFields", []),
            "applicationValidity": row["application_validity"],
            "validityReasonCode": row["validity_reason_code"],
            "analysisEligible": row["application_validity"] != "INVALID",
            "readState": row["read_state"],
            "applicationStatus": row["application_status"],
            "statusUpdatedAt": row["status_updated_at"],
            "firstObservedAt": row["first_observed_at"],
            "updatedAt": row["updated_at"],
            "createdAt": row["created_at"],
            "contactedAt": min(contacts) if contacts else None,
            "status": outcomes[-1] if outcomes else stage,
            "currentStage": stage,
            "outcome": outcomes[-1] if outcomes else "OPEN",
            "preparedResumeVersionId": row["prepared_resume_version_id"],
            "strategyPlanId": row["strategy_plan_id"],
            "resumeExposure": await self.exposure(uid, row["id"], events, c),
            "events": [self.event_view(event) for event in events],
        }
        if detail:
            result.update(
                jobBaseInfo=value.get("jobBaseInfo", "{}"),
                jobExtInfo=value.get("jobExtInfo", "{}"),
                jdText=row["jd_text"],
                statusEvidence=loads(row["status_evidence_json"], {}),
                validityEvidence=loads(row["validity_evidence_json"], {}),
                snapshot=value,
            )
        return result

    async def application_list(self, uid, limit=20, offset=0):
        rows = await self.db.rows(
            select(self.applications)
            .where(self.applications.c.user_id == uid)
            .order_by(self.applications.c.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return [await self.application_view(uid, row) for row in rows]

    async def activate_outreach_campaign(self, uid, payload):
        value = {
            "campaignId": payload.campaignId,
            "messages": payload.messages,
            "status": "ACTIVE",
            "createdAt": now_ms(),
        }
        async with self.transaction(uid) as c:
            await self.db.set_control(c, uid, "outreach:active", value)
        return value

    async def outreach_campaign_candidates(self, uid, limit=50, offset=0):
        """Return exact, non-terminal greeted conversations and the next durable step."""
        campaign = await self.db.control(uid, "outreach:active", None)
        if not isinstance(campaign, dict) or campaign.get("status") != "ACTIVE":
            return {"campaign": None, "items": [], "eligibleCount": 0}
        messages = campaign.get("messages")
        if not isinstance(messages, list) or len(messages) != 2:
            return {"campaign": None, "items": [], "eligibleCount": 0}
        terminal_statuses = {
            "WITHDRAWN",
            "EXPLICIT_REJECTED",
            "INTERVIEW_SCHEDULED",
            "OFFER_RECEIVED",
        }
        rows = await self.db.rows(
            select(self.applications)
            .where(
                self.applications.c.user_id == uid,
                self.applications.c.platform_account.is_not(None),
                self.applications.c.encrypt_job_id.is_not(None),
                self.applications.c.conversation_key.is_not(None),
                self.applications.c.boss_id.is_not(None),
                self.applications.c.application_status.not_in(terminal_statuses),
            )
            .order_by(self.applications.c.created_at, self.applications.c.id)
            .limit(limit)
            .offset(offset)
        )
        items = []
        for row in rows:
            events = effective_events(
                [
                    event
                    for event in await self.timeline(uid, row["id"])
                    if event["confirmation"] != "INFERRED"
                ]
            )
            if not any(event["event_type"] == "CONTACT_INITIATED" for event in events):
                continue
            if any(
                event["event_type"]
                in {
                    "REJECTED",
                    "INTERVIEW_INVITED",
                    "INTERVIEW_COMPLETED",
                    "OFFER_RECEIVED",
                    "WITHDRAWN",
                }
                for event in events
            ):
                continue
            step = 1
            blocked = None
            for candidate_step in (1, 2):
                key = digest(
                    [
                        "FOLLOW_UP",
                        row["platform_account"],
                        [row["id"], campaign["campaignId"], candidate_step],
                    ]
                )
                job = await self.db.one(
                    select(self.jobs)
                    .where(self.jobs.c.user_id == uid, self.jobs.c.business_key == key)
                    .limit(1)
                )
                if not job:
                    step = candidate_step
                    break
                actions = await self.action_rows(uid, job["id"])
                acknowledged = any(
                    action["kind"] == "SEND_TEXT" and action["status"] == "ACKNOWLEDGED"
                    for action in actions
                )
                if not acknowledged:
                    blocked = "PREVIOUS_STEP_NOT_ACKNOWLEDGED"
                    break
                if candidate_step == 2:
                    blocked = "CAMPAIGN_COMPLETE"
                step = candidate_step + 1
            if blocked:
                continue
            items.append(
                {
                    "applicationId": row["id"],
                    "platformAccount": row["platform_account"],
                    "encryptJobId": row["encrypt_job_id"],
                    "conversationKey": row["conversation_key"],
                    "bossId": row["boss_id"],
                    "jobTitle": row["job_title"],
                    "companyName": row["company_name"],
                    "recruiterName": row["recruiter_name"],
                    "salaryText": row["salary_text"],
                    "jdText": (row["jd_text"] or "")[:10000],
                    "campaignId": campaign["campaignId"],
                    "campaignStep": step,
                    "fixedText": messages[step - 1],
                    "anchorOutboundMessageId": "campaign-anchor-" + row["id"],
                    "anchorOutboundAt": row["updated_at"] or row["created_at"],
                    "evidenceTrack": "ACKNOWLEDGED_WAITING",
                }
            )
        return {
            "campaign": {k: campaign[k] for k in ("campaignId", "status", "createdAt")},
            "items": items,
            "eligibleCount": len(items),
        }

    async def follow_up_candidates(
        self, uid, limit=50, offset=0, minimum_age_hours=24, fallback_age_hours=48
    ):
        """Return bounded, explainable candidates; task creation remains browser-owned."""
        terminal_statuses = {
            "WITHDRAWN",
            "EXPLICIT_REJECTED",
            "INTERVIEW_SCHEDULED",
            "OFFER_RECEIVED",
        }
        terminal_events = {
            "REJECTED",
            "INTERVIEW_INVITED",
            "INTERVIEW_COMPLETED",
            "OFFER_RECEIVED",
            "WITHDRAWN",
        }
        condition = self.applications.c.user_id == uid
        candidate_condition = (
            condition
            & (self.applications.c.application_validity == "VALID")
            & self.applications.c.job_title.is_not(None)
            & self.applications.c.company_name.is_not(None)
            & self.applications.c.jd_text.is_not(None)
            & self.applications.c.platform_account.is_not(None)
            & self.applications.c.conversation_key.is_not(None)
            & self.applications.c.boss_id.is_not(None)
            & self.applications.c.application_status.not_in(terminal_statuses)
        )
        total_row = await self.db.one(
            select(func.count().label("count"))
            .select_from(self.applications)
            .where(condition, self.applications.c.read_state == "READ")
        )
        total = total_row["count"] if total_row else 0
        rows = await self.db.rows(
            select(self.applications)
            .where(candidate_condition)
            .order_by(self.applications.c.updated_at.desc(), self.applications.c.id)
            .limit(limit)
            .offset(offset)
        )
        messages = self.db.table("conversation_message")
        jobs = self.db.table("automation_job")
        timestamp = now_ms()
        minimum_age_ms = minimum_age_hours * 60 * 60 * 1000
        fallback_age_ms = fallback_age_hours * 60 * 60 * 1000
        items = []
        for row in rows:
            latest = await self.db.one(
                select(messages)
                .where(messages.c.user_id == uid, messages.c.application_id == row["id"])
                .order_by(messages.c.order_at.desc(), messages.c.id.desc())
                .limit(1)
            )
            previous = await self.db.one(
                select(jobs.c.id)
                .where(
                    jobs.c.user_id == uid,
                    jobs.c.kind == "FOLLOW_UP",
                    jobs.c.business_key
                    == digest(["FOLLOW_UP", row["platform_account"], row["id"]]),
                )
                .limit(1)
            )
            events = effective_events(
                [
                    event
                    for event in await self.timeline(uid, row["id"])
                    if event["confirmation"] != "INFERRED"
                ]
            )
            evidence_track = {
                "READ": "EXACT_READ_NO_REPLY",
                "UNREAD": "EXACT_UNREAD_NO_REPLY",
            }.get(row["read_state"], "ACKNOWLEDGED_WAITING")
            required_age_ms = (
                minimum_age_ms if evidence_track == "EXACT_READ_NO_REPLY" else fallback_age_ms
            )
            blocker = None
            if row["application_validity"] != "VALID":
                blocker = "APPLICATION_NOT_VALIDATED"
            elif not row["job_title"] or not row["company_name"] or not row["jd_text"]:
                blocker = "INCOMPLETE_JOB_METADATA"
            elif not row["platform_account"] or not row["conversation_key"] or not row["boss_id"]:
                blocker = "MISSING_EXACT_BINDING"
            elif row["application_status"] in terminal_statuses or any(
                event["event_type"] in terminal_events for event in events
            ):
                blocker = "TERMINAL_APPLICATION"
            elif previous:
                blocker = "ALREADY_FOLLOWED_UP"
            elif not latest:
                blocker = "MISSING_CONVERSATION_HISTORY"
            elif latest["role"] != "USER":
                blocker = "LATEST_MESSAGE_IS_NOT_USER"
            elif latest["delivery_state"] != "ACKNOWLEDGED":
                blocker = "OUTBOUND_NOT_ACKNOWLEDGED"
            elif timestamp - latest["order_at"] < required_age_ms:
                blocker = "TOO_RECENT"
            items.append(
                {
                    "applicationId": row["id"],
                    "platformAccount": row["platform_account"],
                    "encryptJobId": row["encrypt_job_id"],
                    "conversationKey": row["conversation_key"],
                    "bossId": row["boss_id"],
                    "jobTitle": row["job_title"],
                    "companyName": row["company_name"],
                    "recruiterName": row["recruiter_name"],
                    "salaryText": row["salary_text"],
                    "applicationValidity": row["application_validity"],
                    "applicationStatus": row["application_status"],
                    "readState": row["read_state"],
                    "evidenceTrack": evidence_track,
                    "requiredAgeHours": minimum_age_hours
                    if evidence_track == "EXACT_READ_NO_REPLY"
                    else fallback_age_hours,
                    "anchorOutboundMessageId": latest["message_id"] if latest else None,
                    "anchorOutboundAt": latest["order_at"] if latest else None,
                    "jdText": (row["jd_text"] or "")[:10000],
                    "eligible": blocker is None,
                    "blocker": blocker,
                }
            )
        return {
            "asOf": timestamp,
            "minimumAgeHours": minimum_age_hours,
            "fallbackAgeHours": fallback_age_hours,
            "exactReadNoReplyCount": int(total or 0),
            "eligibleCount": sum(item["eligible"] for item in items),
            "items": items,
        }

    async def follow_up_dispatch_blocker(self, uid, job, c):
        """Recheck every mutable eligibility fact inside the dispatch transaction."""
        raw = loads(job["input_json"], {}).get("input", {})
        app = await self.db.one(
            select(self.applications).where(
                self.applications.c.user_id == uid,
                self.applications.c.id == raw.get("applicationId"),
            ),
            c,
        )
        campaign_id = raw.get("campaignId")
        if not app or (not campaign_id and app["application_validity"] != "VALID"):
            return "FOLLOW_UP_APPLICATION_CHANGED"
        if (
            app["platform_account"] != job["platform_account"]
            or app["encrypt_job_id"] != job["encrypt_job_id"]
            or app["conversation_key"] != job["conversation_key"]
            or app["boss_id"] != job["boss_id"]
        ):
            return "FOLLOW_UP_BINDING_CHANGED"
        if app["application_status"] in {
            "WITHDRAWN",
            "EXPLICIT_REJECTED",
            "INTERVIEW_SCHEDULED",
            "OFFER_RECEIVED",
        }:
            return "FOLLOW_UP_APPLICATION_TERMINAL"
        events = effective_events(
            [
                event
                for event in await self.timeline(uid, app["id"], c)
                if event["confirmation"] != "INFERRED"
            ]
        )
        if any(
            event["event_type"]
            in {
                "REJECTED",
                "INTERVIEW_INVITED",
                "INTERVIEW_COMPLETED",
                "OFFER_RECEIVED",
                "WITHDRAWN",
            }
            for event in events
        ):
            return "FOLLOW_UP_APPLICATION_TERMINAL"
        if campaign_id:
            campaign = await self.db.control(uid, "outreach:active", None, c)
            if (
                not isinstance(campaign, dict)
                or campaign.get("status") != "ACTIVE"
                or campaign.get("campaignId") != campaign_id
                or raw.get("campaignStep") not in {1, 2}
                or campaign.get("messages", [None, None])[raw["campaignStep"] - 1]
                != raw.get("fixedText")
            ):
                return "FOLLOW_UP_APPLICATION_CHANGED"
            return None
        messages = self.db.table("conversation_message")
        latest = await self.db.one(
            select(messages)
            .where(messages.c.user_id == uid, messages.c.application_id == app["id"])
            .order_by(messages.c.order_at.desc(), messages.c.id.desc())
            .limit(1),
            c,
        )
        if (
            not latest
            or latest["message_id"] != raw.get("anchorOutboundMessageId")
            or latest["order_at"] != raw.get("anchorOutboundAt")
            or latest["role"] != "USER"
            or latest["delivery_state"] != "ACKNOWLEDGED"
        ):
            return "FOLLOW_UP_CONVERSATION_CHANGED"
        return None

    async def refresh_follow_up_binding(self, uid, ident, payload):
        """Rotate only a proven stale BOSS conversation binding for one safe follow-up."""
        terminal_statuses = {
            "WITHDRAWN",
            "EXPLICIT_REJECTED",
            "INTERVIEW_SCHEDULED",
            "OFFER_RECEIVED",
        }
        terminal_events = {
            "REJECTED",
            "INTERVIEW_INVITED",
            "INTERVIEW_COMPLETED",
            "OFFER_RECEIVED",
            "WITHDRAWN",
        }
        async with self.transaction(uid) as c:
            app = await self.row(self.applications, uid, ident, c)
            if (
                app["application_validity"] != "VALID"
                or app["application_status"] in terminal_statuses
                or app["encrypt_job_id"] != payload.encryptJobId
                or app["boss_id"] != payload.bossId
                or app["conversation_key"]
                not in {payload.oldConversationKey, payload.newConversationKey}
            ):
                raise ApiError("FOLLOW_UP_BINDING_CHANGED", 409)
            events = effective_events(
                [
                    event
                    for event in await self.timeline(uid, ident, c)
                    if event["confirmation"] != "INFERRED"
                ]
            )
            if any(event["event_type"] in terminal_events for event in events):
                raise ApiError("FOLLOW_UP_APPLICATION_TERMINAL", 409)
            messages = self.db.table("conversation_message")
            latest = await self.db.one(
                select(messages)
                .where(messages.c.user_id == uid, messages.c.application_id == ident)
                .order_by(messages.c.order_at.desc(), messages.c.id.desc())
                .limit(1),
                c,
            )
            if (
                not latest
                or latest["message_id"] != payload.anchorOutboundMessageId
                or latest["order_at"] != payload.anchorOutboundAt
                or latest["role"] != "USER"
                or latest["delivery_state"] != "ACKNOWLEDGED"
            ):
                raise ApiError("FOLLOW_UP_CONVERSATION_CHANGED", 409)
            if app["conversation_key"] == payload.newConversationKey:
                return {
                    "applicationId": ident,
                    "conversationKey": payload.newConversationKey,
                    "updated": False,
                }
            new_conversation_id = conversation_id(
                app["platform_account"],
                payload.newConversationKey,
                payload.bossId,
                payload.encryptJobId,
            )
            conflict = await self.db.one(
                select(messages.c.id)
                .where(
                    messages.c.user_id == uid,
                    messages.c.conversation_id == new_conversation_id,
                )
                .limit(1),
                c,
            )
            if conflict:
                raise ApiError("FOLLOW_UP_BINDING_CONFLICT", 409)
            timestamp = now_ms()
            await c.execute(
                messages.update()
                .where(messages.c.user_id == uid, messages.c.application_id == ident)
                .values(
                    conversation_id=new_conversation_id,
                    conversation_key=payload.newConversationKey,
                    updated_at=timestamp,
                )
            )
            await c.execute(
                self.applications.update()
                .where(self.applications.c.user_id == uid, self.applications.c.id == ident)
                .values(conversation_key=payload.newConversationKey, updated_at=timestamp)
            )
            return {
                "applicationId": ident,
                "conversationKey": payload.newConversationKey,
                "updated": True,
            }

    async def insert_application(
        self,
        c,
        uid,
        account,
        encrypt_job_id,
        cycle,
        data,
        *,
        conversation=None,
        boss=None,
        job_id=None,
        prepared=None,
        strategy=None,
        legacy_id=None,
        created_at=None,
        origin="UNKNOWN",
        source=None,
        observed_at=None,
    ):
        if origin == "UNKNOWN" and str(cycle).startswith("legacy"):
            origin = "LEGACY_IMPORT"
        observed_at = observed_at or created_at or now_ms()
        key = digest([account, encrypt_job_id, cycle])
        old = await self.db.one(
            select(self.applications).where(
                self.applications.c.user_id == uid, self.applications.c.application_key == key
            ),
            c,
        )
        if old:
            enriched = await self.enrich_application(
                c,
                uid,
                dict(old),
                data,
                origin=origin,
                source=source,
                observed_at=observed_at,
                conversation=conversation,
                boss=boss,
                job_id=job_id,
                prepared=prepared,
                strategy=strategy,
            )
            return enriched, True
        normalized, snapshot = _snapshot_data(data, origin, source, observed_at)
        validity = await self.validity_values(
            c, uid, snapshot, observed_at=observed_at, source=source or origin
        )
        created = created_at or now_ms()
        status = "APPLIED" if origin in {"ASSISTANT", "LEGACY_IMPORT"} else "DISCOVERED"
        row = dict(
            id=identifier(),
            user_id=uid,
            application_key=key,
            platform_account=account,
            encrypt_job_id=encrypt_job_id,
            conversation_key=conversation,
            boss_id=boss,
            cycle_key=cycle,
            job_id=job_id,
            prepared_resume_version_id=prepared,
            strategy_plan_id=strategy,
            contacted_at=None,
            origin=origin,
            **normalized,
            snapshot_completeness=snapshot["snapshotCompleteness"],
            **validity,
            read_state="UNKNOWN",
            read_state_updated_at=None,
            application_status=status,
            status_updated_at=observed_at,
            status_evidence_json=dumps(
                {"source": source or origin, "asOf": observed_at, "status": status}
            ),
            first_observed_at=observed_at,
            data_json=dumps(snapshot),
            legacy_snapshot_id=legacy_id,
            created_at=created,
            updated_at=created,
        )
        await c.execute(self.applications.insert().values(**row))
        return row, False

    async def enrich_application(
        self,
        c,
        uid,
        app,
        data,
        *,
        origin,
        source,
        observed_at,
        conversation=None,
        boss=None,
        job_id=None,
        prepared=None,
        strategy=None,
    ):
        merged_origin, (normalized, snapshot) = _merge_snapshot(
            app["data_json"], data, app["origin"], origin, source, observed_at
        )
        status = app["application_status"]
        if status == "DISCOVERED" and merged_origin in {"ASSISTANT", "LEGACY_IMPORT"}:
            status = "APPLIED"
        validity = await self.validity_values(
            c, uid, snapshot, observed_at=observed_at, source=source or origin
        )
        values = dict(
            origin=merged_origin,
            **normalized,
            snapshot_completeness=snapshot["snapshotCompleteness"],
            **validity,
            data_json=dumps(snapshot),
            conversation_key=app["conversation_key"] or conversation,
            boss_id=app["boss_id"] or boss,
            job_id=app["job_id"] or job_id,
            prepared_resume_version_id=app["prepared_resume_version_id"] or prepared,
            strategy_plan_id=app["strategy_plan_id"] or strategy,
            first_observed_at=min(
                value for value in (app["first_observed_at"], observed_at) if value is not None
            ),
            application_status=status,
            updated_at=now_ms(),
        )
        await c.execute(
            self.applications.update()
            .where(self.applications.c.id == app["id"], self.applications.c.user_id == uid)
            .values(**values)
        )
        return {**app, **values}

    async def update_application_status(
        self,
        c,
        uid,
        app,
        *,
        status,
        as_of,
        evidence,
        read_state="UNKNOWN",
        read_state_as_of=None,
    ):
        values = {"updated_at": now_ms()}
        read_at = read_state_as_of or as_of
        if read_state in {"READ", "UNREAD"} and read_at >= (app["read_state_updated_at"] or 0):
            values.update(read_state=read_state, read_state_updated_at=read_at)
        current = app["application_status"] or "DISCOVERED"
        current_priority = STATUS_PRIORITY.get(current, 0)
        incoming_priority = STATUS_PRIORITY.get(status, 0)
        if incoming_priority > current_priority or (
            incoming_priority == current_priority and as_of >= (app["status_updated_at"] or 0)
        ):
            values.update(
                application_status=status,
                status_updated_at=as_of,
                status_evidence_json=dumps(evidence),
            )
        await c.execute(
            self.applications.update()
            .where(self.applications.c.id == app["id"], self.applications.c.user_id == uid)
            .values(**values)
        )
        return {**app, **values}

    async def insert_event(
        self, c, uid, app, event_type, occurred_at, evidence, confirmation, supersedes=None
    ):
        if occurred_at > now_ms() + 60000:
            raise ApiError("INVALID_EVENT_TIME", 422)
        if supersedes:
            previous = await self.row(self.application_events, uid, supersedes, c)
            if previous["application_id"] != app["id"]:
                raise ApiError("EVENT_BINDING_CONFLICT", 409)
            replaced = await self.owned_rows(
                self.application_events,
                uid,
                c,
                self.application_events.c.supersedes_event_id == supersedes,
                self.application_events.c.confirmation != "INFERRED",
            )
            if replaced:
                raise ApiError("EVENT_ALREADY_CORRECTED", 409)
        version_id = evidence.get("resumeVersionId")
        verified = False
        if version_id:
            version = await self.row(self.versions, uid, version_id, c)
            verified = (
                confirmation == "USER_CONFIRMED"
                and evidence.get("contentHash") == version["content_hash"]
            )
            if evidence.get("contentHash") and evidence["contentHash"] != version["content_hash"]:
                raise ApiError("RESUME_PROOF_MISMATCH", 409)
        row = dict(
            id=identifier(),
            user_id=uid,
            application_id=app["id"],
            event_type=event_type,
            occurred_at=occurred_at,
            confirmation=confirmation,
            evidence_json=dumps(evidence),
            supersedes_event_id=supersedes,
            created_at=now_ms(),
        )
        await c.execute(self.application_events.insert().values(**row))
        if event_type == "CONTACT_INITIATED" and confirmation != "INFERRED":
            earliest = min(occurred_at, app["contacted_at"] or occurred_at)
            await c.execute(
                self.applications.update()
                .where(self.applications.c.id == app["id"], self.applications.c.user_id == uid)
                .values(contacted_at=earliest)
            )
        projected_status = {
            "APPLICATION_DISCOVERED": "DISCOVERED",
            "CONTACT_INITIATED": "APPLIED",
            "HR_REPLIED": "HR_REPLIED",
            "INTERVIEW_INVITED": "INTERVIEW_SCHEDULED",
            "REJECTED": "EXPLICIT_REJECTED",
            "OFFER_RECEIVED": "OFFER_RECEIVED",
            "WITHDRAWN": "WITHDRAWN",
        }.get(event_type)
        if projected_status and confirmation != "INFERRED":
            await self.update_application_status(
                c,
                uid,
                app,
                status=projected_status,
                as_of=occurred_at,
                evidence={"eventType": event_type, **evidence},
            )
        if event_type == "RESUME_SENT":
            await c.execute(
                self.exposures.insert().values(
                    id=identifier(),
                    user_id=uid,
                    application_id=app["id"],
                    event_id=row["id"],
                    resume_version_id=version_id if verified else None,
                    state="VERIFIED" if verified else "UNKNOWN",
                    verification_kind="USER_CONFIRMED"
                    if verified
                    else "PLATFORM_ATTACHMENT_ACK"
                    if confirmation == "OBSERVED"
                    else "UNVERIFIED",
                    platform_resume_id=evidence.get("platformResumeId"),
                    created_at=now_ms(),
                )
            )
        return row

    async def ensure_legacy_contact(self, c, uid, app, snapshot) -> bool:
        """Treat a persisted application snapshot as observed contact evidence once."""
        events = await self.timeline(uid, app["id"], c)
        if any(
            event["event_type"] == "CONTACT_INITIATED" and event["confirmation"] != "INFERRED"
            for event in effective_events(events)
        ):
            return False
        occurred_at = snapshot["applied_at"] or snapshot["created_at"]
        if not occurred_at:
            return False
        await self.insert_event(
            c,
            uid,
            app,
            "CONTACT_INITIATED",
            occurred_at,
            {
                "source": "LEGACY_APPLICATION_SNAPSHOT",
                "referenceId": str(snapshot["id"]),
                "quote": "已保存投递完成时的岗位与简历快照",
            },
            "OBSERVED",
        )
        return True

    async def add_event(self, uid, app_id, payload):
        async with self.transaction(uid) as c:
            app = await self.row(self.applications, uid, app_id, c)
            raw = {"applicationId": app_id, **payload.model_dump(mode="json")}
            prior = await self.request(c, uid, payload.requestId, "APPLICATION_EVENT", raw)
            if prior:
                return self.event_view(
                    await self.row(self.application_events, uid, prior["eventId"], c)
                )
            event = await self.insert_event(
                c,
                uid,
                app,
                payload.eventType,
                payload.occurredAt,
                payload.evidence.model_dump(exclude_none=True),
                payload.confirmation,
                payload.supersedesEventId,
            )
            await self.request(
                c, uid, payload.requestId, "APPLICATION_EVENT", raw, {"eventId": event["id"]}
            )
            return self.event_view(event)

    async def import_legacy(self, uid, payload):
        from .legacy_sessions import import_legacy_sessions

        async with self.transaction(uid) as c:
            raw = payload.model_dump()
            prior = await self.request(c, uid, payload.requestId, "IMPORT_LEGACY", raw)
            if prior:
                return prior
            snapshots = self.db.table("job_application_snapshot")
            rows = (
                await c.execute(
                    select(snapshots).where(snapshots.c.user_id == uid).order_by(snapshots.c.id)
                )
            ).mappings()
            counts = {
                "importedApplications": 0,
                "importedVersions": 0,
                "reusedApplications": 0,
                "importedContacts": 0,
            }
            for snapshot in rows:
                content = str(snapshot["resume_content"] or "")
                version_id = None
                if content:
                    old = await self.db.one(
                        select(self.versions)
                        .where(
                            self.versions.c.user_id == uid,
                            self.versions.c.content_hash == content_hash(content),
                        )
                        .limit(1),
                        c,
                    )
                    if old:
                        version_id = old["id"]
                    else:
                        version = await self.insert_version(
                            c, uid, content, "LEGACY_IMPORT", created_at=snapshot["created_at"]
                        )
                        version_id = version["id"]
                        counts["importedVersions"] += 1
                base = loads(snapshot["job_base_info"], {})
                data = {
                    "jobTitle": str(base.get("jobName") or "")[:200]
                    if isinstance(base, dict)
                    else "",
                    "jobBaseInfo": snapshot["job_base_info"] or "{}",
                    "jobExtInfo": snapshot["job_ext_info"] or "{}",
                    "capturedResumeContent": content,
                    "capturedPreference": snapshot["preference_snapshot"],
                    "capturedAt": snapshot["applied_at"],
                    "exposureNote": "历史快照不证明附件发送",
                }
                app, reused = await self.insert_application(
                    c,
                    uid,
                    "UNKNOWN",
                    snapshot["encrypt_job_id"],
                    "legacy:" + str(snapshot["id"]),
                    data,
                    prepared=version_id,
                    legacy_id=snapshot["id"],
                    created_at=snapshot["created_at"] or snapshot["applied_at"],
                    origin="LEGACY_IMPORT",
                    source="LEGACY_APPLICATION_SNAPSHOT",
                    observed_at=snapshot["applied_at"] or snapshot["created_at"],
                )
                counts["reusedApplications" if reused else "importedApplications"] += 1
                if await self.ensure_legacy_contact(c, uid, app, snapshot):
                    counts["importedContacts"] += 1
            counts.update(await import_legacy_sessions(c, uid, self))
            await self.request(c, uid, payload.requestId, "IMPORT_LEGACY", raw, counts)
            return counts
