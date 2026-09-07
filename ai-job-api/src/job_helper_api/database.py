import asyncio
import hashlib
import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import (
    BigInteger,
    Column,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
    cast,
    select,
    text,
)
from sqlalchemy.engine import URL, RowMapping
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from sqlalchemy.pool import NullPool

from .automation.schema import TABLES as AUTOMATION_TABLES
from .career.schema import TABLES as CAREER_TABLES
from .errors import ApiError
from .outcomes.schema import TABLES as OUTCOME_TABLES

LEGACY_TABLES = (
    "user_info",
    "user_resume",
    "user_ai_config",
    "msg_session",
    "delivery_audit",
    "job_application_snapshot",
    "rejection_analysis",
)
OWN_TABLES = (
    "py_api_control",
    "py_api_request",
    *OUTCOME_TABLES,
    *AUTOMATION_TABLES,
    *CAREER_TABLES,
)


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def now_date() -> datetime:
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def loads(value: Any, fallback: Any = None) -> Any:
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value) if value else fallback
    except (ValueError, TypeError):
        return fallback


def own_metadata() -> MetaData:
    m = MetaData()
    binary_key = String(255).with_variant(String(255, collation="utf8mb4_bin"), "mysql")
    Table(
        "py_api_control",
        m,
        Column("user_id", BigInteger, primary_key=True),
        Column("control_key", binary_key, primary_key=True),
        Column("value_json", Text, nullable=False),
        Column("updated_at", BigInteger, nullable=False),
    )
    Table(
        "py_api_request",
        m,
        Column("user_id", BigInteger, primary_key=True),
        Column("session_key", binary_key, primary_key=True),
        Column("request_hash", String(64), primary_key=True),
        Column("status", String(32), nullable=False),
        Column("response_json", Text),
        Column("created_at", BigInteger, nullable=False),
        Column("updated_at", BigInteger, nullable=False),
    )
    return m


class Database:
    def __init__(self, url: str | URL) -> None:
        self.engine = create_async_engine(url, pool_pre_ping=True, echo=False)
        # Lock waiters must not exhaust the transaction connection pool.
        self.lock_engine = (
            create_async_engine(url, poolclass=NullPool, echo=False)
            if self.engine.dialect.name == "mysql"
            else None
        )
        self.metadata = MetaData()
        self.ready = False
        self._locks: dict[tuple[int, str], tuple[asyncio.Lock, int]] = {}
        self._open_lock = asyncio.Lock()

    async def open(self) -> None:
        async with self._open_lock:
            metadata = MetaData()
            async with self.engine.connect() as conn:
                await conn.run_sync(
                    lambda c: metadata.reflect(c, only=list(LEGACY_TABLES + OWN_TABLES))
                )
            self.metadata = metadata
            self.ready = all(n in self.metadata.tables for n in LEGACY_TABLES + OWN_TABLES)
            if self.ready:
                self.ready = bool(
                    self.metadata.tables["rejection_analysis"].c.application_snapshot_id.nullable
                )

    async def health(self) -> bool:
        try:
            if not self.ready:
                await self.open()
            async with self.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return self.ready
        except Exception:
            self.ready = False
            return False

    def table(self, name: str) -> Table:
        if not self.ready:
            raise ApiError("数据库或 Python 迁移未就绪", 503)
        return self.metadata.tables[name]

    def exact(self, column, value):
        # Legacy deployments include utf8mb3 and utf8mb4 columns. Binary casts
        # preserve BOSS identifiers without requesting an incompatible collation.
        if self.engine.dialect.name == "mysql":
            return cast(column, LargeBinary) == value.encode("utf-8")
        return column.collate("BINARY") == value

    async def one(self, statement, connection: AsyncConnection | None = None) -> RowMapping | None:
        if connection is not None:
            return (await connection.execute(statement)).mappings().first()
        async with self.engine.connect() as c:
            return (await c.execute(statement)).mappings().first()

    async def rows(self, statement) -> list[RowMapping]:
        async with self.engine.connect() as c:
            return list((await c.execute(statement)).mappings())

    async def user(self, uid: int, connection: AsyncConnection | None = None) -> RowMapping | None:
        t = self.table("user_info")
        return await self.one(select(t).where(t.c.id == uid, t.c.is_active.is_(True)), connection)

    async def resume(
        self, uid: int, connection: AsyncConnection | None = None
    ) -> RowMapping | None:
        t = self.table("user_resume")
        return await self.one(
            select(t)
            .where(t.c.user_id == uid, t.c.is_active.is_(True))
            .order_by(t.c.updated_date.desc(), t.c.id.desc())
            .limit(1),
            connection,
        )

    async def ai_config(
        self, uid: int, connection: AsyncConnection | None = None
    ) -> RowMapping | None:
        t = self.table("user_ai_config")
        return await self.one(
            select(t)
            .where(t.c.user_id == uid, t.c.is_active.is_(True))
            .order_by(t.c.id.desc())
            .limit(1),
            connection,
        )

    async def control(self, uid, key, default=None, connection=None):
        t = self.table("py_api_control")
        row = await self.one(
            select(t.c.value_json).where(t.c.user_id == uid, t.c.control_key == key), connection
        )
        return loads(row["value_json"], default) if row else default

    async def set_control(self, c, uid, key, value):
        t = self.table("py_api_control")
        where = (t.c.user_id == uid) & (t.c.control_key == key)
        row = await self.one(select(t.c.user_id).where(where).with_for_update(), c)
        values = {"value_json": dumps(value), "updated_at": now_ms()}
        if row:
            await c.execute(t.update().where(where).values(**values))
        else:
            await c.execute(t.insert().values(user_id=uid, control_key=key, **values))

    @asynccontextmanager
    async def lock(self, uid: int, key: str) -> AsyncIterator[None]:
        ident = (uid, key)
        lock, users = self._locks.get(ident, (asyncio.Lock(), 0))
        self._locks[ident] = (lock, users + 1)
        try:
            async with lock:
                if self.lock_engine is None:
                    yield
                else:
                    lock_name = (
                        "py-api:"
                        + hashlib.sha256(
                            f"{self.engine.url.database}:{uid}:{key}".encode()
                        ).hexdigest()[:56]
                    )
                    async with self.lock_engine.connect() as connection:
                        acquired = await connection.scalar(
                            text("SELECT GET_LOCK(:name, 5)"), {"name": lock_name}
                        )
                        if acquired != 1:
                            raise ApiError("该操作正在处理中，请稍后查看结果", 409)
                        try:
                            yield
                        finally:
                            await asyncio.shield(
                                connection.execute(
                                    text("SELECT RELEASE_LOCK(:name)"), {"name": lock_name}
                                )
                            )
        finally:
            lock, users = self._locks[ident]
            if users == 1:
                self._locks.pop(ident)
            else:
                self._locks[ident] = (lock, users - 1)

    async def close(self) -> None:
        await self.engine.dispose()
        if self.lock_engine is not None:
            await self.lock_engine.dispose()
