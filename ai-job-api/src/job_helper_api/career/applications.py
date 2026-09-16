from sqlalchemy import select

from ..application_validity import validity_columns
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
