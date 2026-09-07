"""SQLite deletion fences for LangGraph checkpoint-sqlite 3.x storage.

The installed saver stores `checkpoints` and `writes`. SQLite triggers enforce
the fence for every connection/process, including a plain upstream saver.
Write serialization below follows its public aput/aput_writes contract, adding
rollback under the same lock when a deletion trigger rejects a transaction.
"""

import json
import sqlite3

import aiosqlite
from langgraph.checkpoint.base import WRITES_IDX_MAP, get_checkpoint_metadata
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from job_helper_agent.automation_client import AutomationAPIError

DELETED_MARKER = "AUTOMATION_CHECKPOINT_DELETED"


class AutomationCheckpointer(AsyncSqliteSaver):
    async def setup(self):
        await super().setup()
        async with self.lock:
            if getattr(self, "_deletion_setup", False):
                return
            # These triggers execute inside the writer's SQLite transaction;
            # an asyncio lock alone cannot fence another Agent process.
            await self.conn.executescript("""
                CREATE TABLE IF NOT EXISTS automation_checkpoint_tombstone (
                    thread_id TEXT PRIMARY KEY NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS automation_checkpoints_insert_guard
                BEFORE INSERT ON checkpoints
                WHEN EXISTS (SELECT 1 FROM automation_checkpoint_tombstone WHERE thread_id = NEW.thread_id)
                BEGIN SELECT RAISE(ABORT, 'AUTOMATION_CHECKPOINT_DELETED'); END;
                CREATE TRIGGER IF NOT EXISTS automation_checkpoints_update_guard
                BEFORE UPDATE ON checkpoints
                WHEN EXISTS (SELECT 1 FROM automation_checkpoint_tombstone WHERE thread_id = NEW.thread_id)
                  OR EXISTS (SELECT 1 FROM automation_checkpoint_tombstone WHERE thread_id = OLD.thread_id)
                BEGIN SELECT RAISE(ABORT, 'AUTOMATION_CHECKPOINT_DELETED'); END;
                CREATE TRIGGER IF NOT EXISTS automation_writes_insert_guard
                BEFORE INSERT ON writes
                WHEN EXISTS (SELECT 1 FROM automation_checkpoint_tombstone WHERE thread_id = NEW.thread_id)
                BEGIN SELECT RAISE(ABORT, 'AUTOMATION_CHECKPOINT_DELETED'); END;
                CREATE TRIGGER IF NOT EXISTS automation_writes_update_guard
                BEFORE UPDATE ON writes
                WHEN EXISTS (SELECT 1 FROM automation_checkpoint_tombstone WHERE thread_id = NEW.thread_id)
                  OR EXISTS (SELECT 1 FROM automation_checkpoint_tombstone WHERE thread_id = OLD.thread_id)
                BEGIN SELECT RAISE(ABORT, 'AUTOMATION_CHECKPOINT_DELETED'); END;
            """)
            await self.conn.commit()
            self._deletion_setup = True

    async def _write(self, query, values):
        await self.setup()
        async with self.lock:
            try:
                async with self.conn.cursor() as cursor:
                    await cursor.executemany(query, values)
                await self.conn.commit()
            except BaseException as error:
                await self.conn.rollback()
                if (
                    isinstance(error, sqlite3.IntegrityError)
                    and str(error) == DELETED_MARKER
                ):
                    raise AutomationAPIError("JOB_DELETED", lease_lost=True) from None
                raise

    async def aput(self, config, checkpoint, metadata, new_versions):
        binding = config["configurable"]
        thread_id, namespace = str(binding["thread_id"]), binding["checkpoint_ns"]
        kind, serialized = self.serde.dumps_typed(checkpoint)
        metadata_bytes = json.dumps(
            get_checkpoint_metadata(config, metadata), ensure_ascii=False
        ).encode("utf-8", "ignore")
        await self._write(
            "INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    thread_id,
                    namespace,
                    checkpoint["id"],
                    binding.get("checkpoint_id"),
                    kind,
                    serialized,
                    metadata_bytes,
                )
            ],
        )
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": namespace,
                "checkpoint_id": checkpoint["id"],
            }
        }

    async def aput_writes(self, config, writes, task_id, task_path=""):
        binding = config["configurable"]
        query = (
            "INSERT OR REPLACE INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            if all(item[0] in WRITES_IDX_MAP for item in writes)
            else "INSERT OR IGNORE INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        await self._write(
            query,
            [
                (
                    str(binding["thread_id"]),
                    str(binding["checkpoint_ns"]),
                    str(binding["checkpoint_id"]),
                    task_id,
                    WRITES_IDX_MAP.get(channel, index),
                    channel,
                    *self.serde.dumps_typed(value),
                )
                for index, (channel, value) in enumerate(writes)
            ],
        )

    async def permanently_delete(self, thread_id):
        if not thread_id.startswith("automation:") or len(thread_id) <= len(
            "automation:"
        ):
            raise ValueError("cleanup requires an automation thread")
        # Persist first: a crash or failed deletion remains fenced and retryable.
        await self._write(
            "INSERT OR IGNORE INTO automation_checkpoint_tombstone (thread_id) VALUES (?)",
            [(thread_id,)],
        )
        async with self.lock, self.conn.execute("PRAGMA database_list") as cursor:
            databases = await cursor.fetchall()
        path = next((row[2] for row in databases if row[1] == "main"), "")
        if not path:
            raise ValueError("cleanup requires a persistent SQLite database")
        # The upstream method is called on a dedicated connection. A failed
        # DELETE can then roll back/close without disturbing active graph writes.
        async with aiosqlite.connect(path) as connection:
            saver = AsyncSqliteSaver(connection, serde=self.serde)
            await saver.setup()
            await saver.adelete_thread(thread_id)
            for table in ("checkpoints", "writes"):
                async with connection.execute(
                    f"SELECT count(*) FROM {table} WHERE thread_id = ?", (thread_id,)
                ) as cursor:
                    if (await cursor.fetchone())[0]:
                        raise sqlite3.OperationalError("CHECKPOINT_DELETE_INCOMPLETE")
