from ..automation.storage import digest, identifier
from ..database import dumps, loads, now_ms
from ..errors import ApiError
from .applications import effective_events
from .strategies import Strategies


class Reviews(Strategies):
    async def submit_review(self, uid, payload):
        if payload.cutoff > now_ms() + 60000:
            raise ApiError("INVALID_EVENT_TIME", 422)
        async with self.transaction(uid) as c:
            raw = payload.model_dump(mode="json")
            prior = await self.request(c, uid, payload.requestId, "REVIEW", raw)
            if prior:
                return await self.view(uid, await self.row(self.jobs, uid, prior["jobId"], c), c)
            preference = await self.preference(uid, c)
            if payload.hardConstraints and digest(payload.hardConstraints) != digest(preference):
                raise ApiError("HARD_CONSTRAINTS_CHANGED", 409)
            version_id = (
                payload.resumeVersionId or (await self.selection(uid, c))["preparedResumeVersionId"]
            )
            version = (
                await self.version_view(uid, await self.row(self.versions, uid, version_id, c), c)
                if version_id
                else None
            )
            metrics = await self.analytics(uid, payload.windowDays, payload.cutoff, c=c)
            evidence = []
            applications = sorted(
                await self.owned_rows(self.applications, uid, c),
                key=lambda a: (a["created_at"], a["id"]),
                reverse=True,
            )
            job_samples, characters = [], 0
            for app in applications:
                data = self.json_value(app)
                base, ext = data.get("jobBaseInfo", "{}"), data.get("jobExtInfo", "{}")
                size = len(base) + len(ext)
                if len(job_samples) < 20 and characters + size <= 200000:
                    job_samples.append(
                        {
                            "jdRef": "application:" + app["id"],
                            "applicationId": app["id"],
                            "jobBaseInfo": base,
                            "jobExtInfo": ext,
                        }
                    )
                    characters += size
                eligible = [
                    event
                    for event in await self.timeline(uid, app["id"], c)
                    if event["confirmation"] != "INFERRED"
                    and event["occurred_at"] <= payload.cutoff
                ]
                for event in effective_events(eligible):
                    if (
                        event["confirmation"] != "INFERRED"
                        and event["occurred_at"] <= payload.cutoff
                        and event["event_type"]
                        in {
                            "HR_REPLIED",
                            "INTERVIEW_INVITED",
                            "INTERVIEW_COMPLETED",
                            "OFFER_RECEIVED",
                            "REJECTED",
                            "WITHDRAWN",
                        }
                    ):
                        evidence.append(
                            {
                                "eventId": event["id"],
                                "applicationId": app["id"],
                                "quote": loads(event["evidence_json"], {}).get("quote", ""),
                                "confirmation": event["confirmation"],
                                "eventType": event["event_type"],
                                "source": loads(event["evidence_json"], {}).get(
                                    "source", "UNKNOWN"
                                ),
                                "occurredAt": event["occurred_at"],
                                "_at": event["occurred_at"],
                            }
                        )
            total_evidence = len(evidence)
            evidence = sorted(evidence, key=lambda x: (x["_at"], x["eventId"]), reverse=True)[:200]
            for event in evidence:
                event.pop("_at")
            coverage = {
                "selection": "最新确认事件优先；完整岗位资料按应用创建时间倒序，在 20 条及 200000 字符预算内选取，不截断选中的岗位正文。",
                "eventCount": total_evidence,
                "includedEventCount": len(evidence),
                "applicationCount": len(applications),
                "includedJobCount": len(job_samples),
            }
            metrics["uncertainties"].append(
                f"复盘证据包含 {len(evidence)}/{total_evidence} 条确认事件，岗位资料包含 {len(job_samples)}/{len(applications)} 条完整样本；统计仍使用全部符合条件的记录。"
            )
            # Reviews have no send authority. Invalid/disabled model config must still allow an honest rules fallback.
            context = {
                "preference": preference,
                "scopeHash": digest(
                    [
                        preference,
                        version_id,
                        await self.db.control(uid, "automation:authority-epoch", 0, c),
                    ]
                ),
                "missingMaterials": [] if version else ["PREPARED_RESUME_VERSION"],
                "careerReview": {
                    "metrics": metrics,
                    "evidence": evidence,
                    "version": version,
                    "jobSamples": job_samples,
                    "coverage": coverage,
                },
            }
            timestamp, ident = now_ms(), identifier()
            job_raw = {"kind": "CAREER_REVIEW", "input": raw}
            job = dict(
                id=ident,
                user_id=uid,
                business_key=digest(["CAREER_REVIEW", payload.requestId]),
                kind="CAREER_REVIEW",
                platform_account="NONE",
                conversation_key=None,
                encrypt_job_id=None,
                boss_id=None,
                revision=1,
                input_hash=digest([job_raw, context]),
                input_json=dumps(job_raw),
                context_json=dumps(context),
                status="READY",
                phase="QUEUED",
                phase_history_json=dumps([{"phase": "QUEUED", "at": timestamp}]),
                available_at=timestamp,
                lease_token=None,
                lease_until=None,
                attempts=0,
                compute_started=0,
                graph_finalized=1,
                artifact_id=None,
                artifact_json=None,
                validation_hash=None,
                result_json=None,
                result_id=None,
                last_error_code=None,
                created_at=timestamp,
                updated_at=timestamp,
            )
            await c.execute(self.jobs.insert().values(**job))
            await self.request(c, uid, payload.requestId, "REVIEW", raw, {"jobId": ident})
            return await self.view(uid, job, c)

    async def persist_review(self, c, job, artifact):
        review = artifact["result"]["analysis"]
        for proposal in review["resumeProposals"]:
            await c.execute(
                self.proposals.insert().values(
                    id=proposal["proposalId"],
                    user_id=job["user_id"],
                    job_id=job["id"],
                    base_version_id=proposal["baseVersionId"],
                    status="DRAFT",
                    data_json=dumps(
                        {
                            "patches": proposal["patches"],
                            "evidenceIds": [e["eventId"] for e in review["evidence"]],
                        }
                    ),
                    accepted_version_id=None,
                    accept_hash=None,
                    created_at=job["created_at"],
                )
            )
        strategy = review["strategy"]
        value = {
            k: v
            for k, v in strategy.items()
            if k not in {"strategyId", "status", "previewHash", "basePreferenceHash", "createdAt"}
        }
        await c.execute(
            self.strategies.insert().values(
                id=strategy["strategyId"],
                user_id=job["user_id"],
                job_id=job["id"],
                status="DRAFT",
                data_json=dumps(value),
                preview_hash=strategy["previewHash"],
                base_preference_hash=strategy["basePreferenceHash"],
                approved_at=None,
                applied_at=None,
                created_at=job["created_at"],
            )
        )

    async def review_view(self, uid, job_id):
        job = await self.row(self.jobs, uid, job_id)
        if job["kind"] != "CAREER_REVIEW":
            raise ApiError("NOT_FOUND", 404)
        tombstone = await self.tombstone(uid, job_id)
        if tombstone:
            return {
                "jobId": job_id,
                "status": tombstone["status"],
                "checkpointDeleted": tombstone["status"] == "DELETED",
            }
        result = loads(job["result_json"], {})
        review = result.get("analysis")
        if review:
            review["resumeProposals"] = [
                self.proposal_view(row)
                for row in await self.owned_rows(
                    self.proposals, uid, None, self.proposals.c.job_id == job_id
                )
            ]
            strategies = await self.owned_rows(
                self.strategies, uid, None, self.strategies.c.job_id == job_id
            )
            review["strategy"] = self.strategy_view(strategies[0]) if strategies else None
        confirmation = await self.db.control(uid, "career:confirmation:" + job_id, None)
        return {"job": await self.view(uid, job), "review": review, "confirmation": confirmation}

    async def confirm_review(self, uid, job_id, payload):
        async with self.transaction(uid) as c:
            job = await self.row(self.jobs, uid, job_id, c)
            if await self.tombstone(uid, job_id, c):
                raise ApiError("JOB_DELETED", 409)
            if (
                job["kind"] != "CAREER_REVIEW"
                or payload.revision != job["revision"]
                or payload.inputHash != job["input_hash"]
                or not job["result_id"]
            ):
                raise ApiError("REVIEW_CHANGED", 409)
            raw = {"jobId": job_id, **payload.model_dump()}
            prior = await self.request(c, uid, payload.requestId, "CONFIRM_REVIEW", raw)
            if not prior:
                existing = await self.db.control(uid, "career:confirmation:" + job_id, None, c)
                if existing and existing["decision"] != payload.decision:
                    raise ApiError("REVIEW_ALREADY_CONFIRMED", 409)
                if not existing:
                    await self.db.set_control(
                        c,
                        uid,
                        "career:confirmation:" + job_id,
                        {
                            "confirmationId": identifier(),
                            "decision": payload.decision,
                            "createdAt": now_ms(),
                        },
                    )
                await self.request(
                    c, uid, payload.requestId, "CONFIRM_REVIEW", raw, {"jobId": job_id}
                )
                await self.wake(c, job)
            return {"jobId": job_id, "status": job["status"]}
