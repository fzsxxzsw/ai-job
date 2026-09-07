"""A separate process using the unmodified installed LangGraph saver."""

import asyncio
import sqlite3
import sys

import aiosqlite
from job_helper_agent.automation_checkpoint import DELETED_MARKER
from job_helper_agent.main import STRICT_CHECKPOINT_SERIALIZER
from langgraph.checkpoint.base import empty_checkpoint
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


async def main():
    async with aiosqlite.connect(sys.argv[1]) as connection:
        saver = AsyncSqliteSaver(connection, serde=STRICT_CHECKPOINT_SERIALIZER)
        await saver.setup()
        config = {
            "configurable": {
                "thread_id": "automation:job-1",
                "checkpoint_ns": "",
                "checkpoint_id": "late-cp",
            }
        }
        blocked = 0
        for operation in (
            lambda: saver.aput(config, empty_checkpoint(), {}, {}),
            lambda: saver.aput_writes(
                config, [("artifact_id", "late-ref")], "late-task"
            ),
        ):
            try:
                await operation()
            except sqlite3.IntegrityError as error:
                assert str(error) == DELETED_MARKER
                blocked += 1
                await connection.rollback()
        assert blocked == 2
        for table in ("checkpoints", "writes"):
            assert (
                await (
                    await connection.execute(
                        f"SELECT count(*) FROM {table} WHERE thread_id = ?",
                        ("automation:job-1",),
                    )
                ).fetchone()
            )[0] == 0
    print("BOTH_WRITES_BLOCKED")


if __name__ == "__main__":
    asyncio.run(main())
