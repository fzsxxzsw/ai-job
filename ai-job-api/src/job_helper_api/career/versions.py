import hashlib
import re

from sqlalchemy import select

from ..automation.storage import identifier
from ..database import dumps, now_ms
from ..errors import ApiError
from ..execution_authority import bump_authority
from .base import CareerStore


def content_hash(content):
    return hashlib.sha256(content.encode()).hexdigest()


def sections(content):
    values = re.split(r"\n\s*\n", content)
    return [
        {
            "sectionId": f"section-{i + 1}",
            "title": part.strip().splitlines()[0][:80],
            "text": part.strip(),
        }
        for i, part in enumerate(values)
        if part.strip()
    ]


class Versions(CareerStore):
    async def insert_version(
        self, c, uid, content, source, parent_id=None, facts=None, created_at=None
    ):
        if parent_id:
            await self.row(self.versions, uid, parent_id, c)
        ident = identifier()
        parsed = sections(content)
        facts = facts or [
            {
                "factId": section["sectionId"],
                "text": section["text"][:4000],
                "verificationStatus": "SOURCE_PRESENT",
            }
            for section in parsed
        ]
        value = {"content": content, "sections": parsed, "facts": facts}
        row = dict(
            id=ident,
            user_id=uid,
            parent_id=parent_id,
            source=source,
            content_hash=content_hash(content),
            data_json=dumps(value),
            created_at=created_at or now_ms(),
        )
        await c.execute(self.versions.insert().values(**row))
        return row

    async def version_view(self, uid, row, c=None):
        value = self.json_value(row)
        return {
            "versionId": row["id"],
            "contentHash": row["content_hash"],
            "parentVersionId": row["parent_id"],
            "source": row["source"],
            "status": "PREPARED",
            "selected": (await self.selection(uid, c))["preparedResumeVersionId"] == row["id"],
            "createdAt": row["created_at"],
            **value,
        }

    async def create_version(self, uid, payload):
        async with self.transaction(uid) as c:
            raw = payload.model_dump(mode="json")
            prior = await self.request(c, uid, payload.requestId, "CREATE_VERSION", raw)
            if prior:
                return await self.version_view(
                    uid, await self.row(self.versions, uid, prior["versionId"], c), c
                )
            row = await self.insert_version(
                c,
                uid,
                payload.content,
                payload.source,
                payload.parentVersionId,
                [f.model_dump() for f in payload.facts],
            )
            await self.request(
                c, uid, payload.requestId, "CREATE_VERSION", raw, {"versionId": row["id"]}
            )
            return await self.version_view(uid, row, c)

    async def version_list(self, uid, limit=20, offset=0):
        rows = await self.db.rows(
            select(self.versions)
            .where(self.versions.c.user_id == uid)
            .order_by(self.versions.c.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return [await self.version_view(uid, row) for row in rows]

    async def select_version(self, uid, ident, payload):
        async with self.transaction(uid) as c:
            raw = {"versionId": ident, **payload.model_dump()}
            prior = await self.request(c, uid, payload.requestId, "SELECT_VERSION", raw)
            if prior:
                return prior
            await self.row(self.versions, uid, ident, c)
            if (await self.selection(uid, c))[
                "preparedResumeVersionId"
            ] != payload.baseActiveVersionId:
                raise ApiError("ACTIVE_VERSION_CHANGED", 409)
            await bump_authority(self.db, c, uid)
            await self.db.set_control(c, uid, "career:active-resume", ident)
            result = {"versionId": ident, "selected": True}
            await self.request(c, uid, payload.requestId, "SELECT_VERSION", raw, result)
            return result
