"""Immutable, individually selected resume edits with source-preserving validation."""

import re

from ..automation.storage import digest
from ..errors import ApiError
from .analytics import Analytics


def normalized_text(value):
    return re.sub(r"\s+", "", value)


def validate_patch(patch, version, evidence_ids):
    section = next(
        (s for s in version["sections"] if s["sectionId"] == patch.get("sectionId")), None
    )
    facts = {f["factId"]: f for f in version["facts"]}
    return bool(
        section
        and patch.get("originalText") == section["text"]
        and isinstance(patch.get("proposedText"), str)
        and patch["proposedText"].strip()
        # This release permits formatting only. A cited fact ID alone cannot authorize new claims.
        and normalized_text(patch["proposedText"]) == normalized_text(section["text"])
        and patch.get("verificationStatus") == "SOURCE_SUPPORTED"
        and patch.get("factIds")
        and all(fid in facts for fid in patch["factIds"])
        and all(fid in evidence_ids for fid in patch.get("feedbackEventIds", []))
        and not patch.get("unansweredQuestions")
    )


class Proposals(Analytics):
    def proposal_view(self, row):
        return {
            "proposalId": row["id"],
            "baseVersionId": row["base_version_id"],
            "status": row["status"],
            "patches": self.json_value(row)["patches"],
            "createdAt": row["created_at"],
            "acceptedVersionId": row["accepted_version_id"],
        }

    async def proposal_preview(self, uid, proposal_id, payload, c=None):
        proposal = await self.row(self.proposals, uid, proposal_id, c)
        if await self.tombstone(uid, proposal["job_id"], c):
            raise ApiError("JOB_DELETED", 409)
        base = await self.row(self.versions, uid, proposal["base_version_id"], c)
        version = self.json_value(base)
        document = self.json_value(proposal)
        chosen = payload.selectedPatchIds
        patches = {p["patchId"]: p for p in document["patches"]}
        if len(set(chosen)) != len(chosen) or any(p not in patches for p in chosen):
            raise ApiError("PATCH_SELECTION_INVALID", 422)
        selected = [patches[p] for p in chosen]
        if len({p["sectionId"] for p in selected}) != len(selected) or not all(
            validate_patch(p, version, set(document["evidenceIds"])) for p in selected
        ):
            raise ApiError("PATCH_UNSUPPORTED", 409)
        content = version["content"]
        for patch in selected:
            if content.count(patch["originalText"]) != 1:
                raise ApiError("PATCH_LOCATION_AMBIGUOUS", 409)
            content = content.replace(patch["originalText"], patch["proposedText"], 1)
        result = {
            "proposalId": proposal_id,
            "baseVersionId": base["id"],
            "selectedPatchIds": chosen,
            "content": content,
        }
        return {**result, "previewHash": digest(result)}

    async def accept_proposal(self, uid, proposal_id, payload):
        async with self.transaction(uid) as c:
            raw = {"proposalId": proposal_id, **payload.model_dump()}
            previous = await self.request(c, uid, payload.requestId, "ACCEPT_PROPOSAL", raw)
            if previous:
                return {
                    "proposalId": proposal_id,
                    "version": await self.version_view(
                        uid, await self.row(self.versions, uid, previous["versionId"], c), c
                    ),
                }
            preview = await self.proposal_preview(uid, proposal_id, payload, c)
            if (
                preview["baseVersionId"] != payload.baseVersionId
                or preview["previewHash"] != payload.previewHash
            ):
                raise ApiError("PREVIEW_CHANGED", 409)
            proposal = await self.row(self.proposals, uid, proposal_id, c)
            if proposal["accepted_version_id"]:
                if proposal["accept_hash"] != payload.previewHash:
                    raise ApiError("PROPOSAL_ALREADY_ACCEPTED", 409)
                version = await self.row(self.versions, uid, proposal["accepted_version_id"], c)
            else:
                version = await self.insert_version(
                    c, uid, preview["content"], "ACCEPTED_PATCH", payload.baseVersionId
                )
                await c.execute(
                    self.proposals.update()
                    .where(self.proposals.c.id == proposal_id, self.proposals.c.user_id == uid)
                    .values(
                        status="ACCEPTED",
                        accepted_version_id=version["id"],
                        accept_hash=payload.previewHash,
                    )
                )
            await self.request(
                c, uid, payload.requestId, "ACCEPT_PROPOSAL", raw, {"versionId": version["id"]}
            )
            return {"proposalId": proposal_id, "version": await self.version_view(uid, version, c)}
