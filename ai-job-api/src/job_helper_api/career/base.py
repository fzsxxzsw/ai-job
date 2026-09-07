from sqlalchemy import select

from ..automation.storage import Storage, digest
from ..database import dumps, loads
from ..errors import ApiError


class CareerStore(Storage):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.versions = self.db.table("career_resume_version")
        self.applications = self.db.table("career_application")
        self.application_events = self.db.table("career_application_event")
        self.exposures = self.db.table("career_resume_exposure")
        self.proposals = self.db.table("career_resume_proposal")
        self.strategies = self.db.table("career_strategy_plan")

    async def request(self, c, uid, request_id, kind, raw, result=None):
        key = "career:request:" + digest(request_id)
        previous = await self.db.control(uid, key, None, c)
        hashed = digest([kind, raw])
        if previous:
            if previous["hash"] != hashed:
                raise ApiError("REQUEST_CONFLICT", 409)
            return previous["result"]
        if result is not None:
            await self.db.set_control(c, uid, key, {"hash": hashed, "result": result})
        return None

    async def selection(self, uid, c=None):
        return {
            "preparedResumeVersionId": await self.db.control(uid, "career:active-resume", None, c),
            "strategyPlanId": await self.db.control(uid, "career:active-strategy", None, c),
        }

    async def preference(self, uid, c=None):
        user = await self.db.user(uid, c)
        value = loads((user or {}).get("preference"), {})
        return value if isinstance(value, dict) else {}

    async def owned_rows(self, table, uid, c=None, *conditions):
        statement = select(table).where(table.c.user_id == uid, *conditions)
        if c is None:
            return [dict(r) for r in await self.db.rows(statement)]
        return [dict(r) for r in (await c.execute(statement)).mappings()]

    async def tombstone(self, uid, job_id, c=None):
        return await self.db.control(uid, "career:deleted:" + job_id, None, c)

    def json_value(self, row):
        return loads(row["data_json"], {})

    async def replace_json(self, c, table, uid, ident, value):
        await c.execute(
            table.update()
            .where(table.c.id == ident, table.c.user_id == uid)
            .values(data_json=dumps(value))
        )
