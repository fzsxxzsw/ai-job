"""User-scoped storage; no writes to login, resume, preference or Agent action tables."""
from contextlib import asynccontextmanager
import asyncio
import hashlib
import json
import time
from sqlalchemy import MetaData, select, text
from sqlalchemy.exc import IntegrityError
from .contracts import RejectionError

TABLES = ('user_info', 'user_resume', 'user_ai_config',
          'job_application_snapshot', 'rejection_analysis', 'rejection_gateway_nonce')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def millis():
    return time.time_ns() // 1_000_000


class RejectionStore:
    def __init__(self, engine):
        self.engine, self.metadata, self.ready = engine, MetaData(), False
        self._local_locks = {}

    async def open(self):
        metadata = MetaData()
        async with self.engine.connect() as conn:
            await conn.run_sync(lambda c: metadata.reflect(c, only=list(TABLES)))
        if not metadata.tables['rejection_analysis'].c.application_snapshot_id.nullable:
            raise RejectionError(503, '拒绝分析数据库兼容迁移尚未完成')
        self.metadata, self.ready = metadata, True

    def table(self, name):
        if not self.ready:
            raise RejectionError(503, '拒绝分析数据库尚未就绪')
        return self.metadata.tables[name]

    def exact(self, column, value):
        collation = 'utf8mb4_bin' if self.engine.dialect.name == 'mysql' else 'BINARY'
        return column.collate(collation) == value

    async def one(self, conn, statement):
        return (await conn.execute(statement)).mappings().first()

    async def user(self, conn, uid):
        table = self.table('user_info')
        user = await self.one(conn, select(table).where(table.c.id == uid, table.c.is_active == True))
        if not user:
            raise RejectionError(403, '当前用户不存在或已停用')
        return user

    async def authorize_once(self, uid, nonce, issued_at):
        table = self.table('rejection_gateway_nonce')
        try:
            async with self.engine.begin() as conn:
                await self.user(conn, uid)
                await conn.execute(table.delete().where(table.c.issued_at < int(time.time()) - 120))
                await conn.execute(table.insert().values(nonce=nonce, user_id=uid, issued_at=issued_at))
        except IntegrityError:
            raise RejectionError(409, '内部请求已处理，拒绝重复身份凭据') from None

    async def latest_resume(self, conn, uid):
        table = self.table('user_resume')
        return await self.one(conn, select(table).where(table.c.user_id == uid,
            table.c.is_active == True).order_by(table.c.updated_date.desc(), table.c.id.desc()).limit(1))

    async def model_config(self, conn, uid):
        table = self.table('user_ai_config')
        return await self.one(conn, select(table).where(table.c.user_id == uid,
            table.c.is_active == True).order_by(table.c.id.desc()).limit(1))

    async def snapshot(self, conn, uid, job):
        table = self.table('job_application_snapshot')
        return await self.one(conn, select(table).where(table.c.user_id == uid,
            self.exact(table.c.encrypt_job_id, job)).order_by(table.c.id.desc()).limit(1))

    @asynccontextmanager
    async def guard(self, uid, key):
        lock_name = 'jh-rj:' + digest([str(self.engine.url.database), uid, key])[:56]
        async with self.engine.connect() as conn:
            if self.engine.dialect.name == 'mysql':
                acquired = await conn.scalar(text('SELECT GET_LOCK(:name, 0)'), {'name': lock_name})
                await conn.commit()
                if acquired != 1:
                    raise RejectionError(409, '同一分析正在处理，请稍后重试')
                try:
                    async with conn.begin():
                        yield conn
                finally:
                    await conn.execute(text('SELECT RELEASE_LOCK(:name)'), {'name': lock_name})
                    await conn.commit()
            else:
                lock, users = self._local_locks.get(lock_name, (asyncio.Lock(), 0))
                self._local_locks[lock_name] = (lock, users + 1)
                try:
                    async with lock:
                        async with conn.begin():
                            yield conn
                finally:
                    lock, users = self._local_locks[lock_name]
                    if users == 1:
                        del self._local_locks[lock_name]
                    else:
                        self._local_locks[lock_name] = (lock, users - 1)
