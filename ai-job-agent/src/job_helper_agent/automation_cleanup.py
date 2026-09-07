"""Leased checkpoint cleanup independent of in-flight business graph work."""

import asyncio
import sqlite3
import time
from contextlib import suppress
from uuid import uuid4

from job_helper_agent.automation_client import AutomationAPIError
from job_helper_agent.automation_graph import bounded_request


class AutomationCleanupWorker:
    def __init__(
        self,
        client,
        checkpointer,
        *,
        scan_seconds=5,
        renew_seconds=10,
        timeout_seconds=300,
    ):
        self.client, self.checkpointer = client, checkpointer
        self.scan_seconds, self.renew_seconds, self.timeout_seconds = (
            scan_seconds,
            renew_seconds,
            timeout_seconds,
        )
        self.worker_id = f"career-cleanup-{uuid4().hex}"
        self._task = None
        self.last_error = None
        self.last_successful_claim_at = None
        self.last_deleted_at = None

    @property
    def running(self):
        return self._task is not None and not self._task.done()

    @property
    def ready(self):
        return (
            self.running
            and self.last_successful_claim_at is not None
            and self.last_error is None
        )

    def start(self):
        if self._task is not None:
            raise RuntimeError("cleanup worker already started")
        self._task = asyncio.create_task(self.run(), name="career-cleanup")

    async def stop(self):
        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def run(self):
        while True:
            try:
                claim = await self.client.cleanup_claim(self.worker_id)
                self.last_successful_claim_at = int(time.time() * 1000)
                self.last_error = None
                if claim is not None:
                    await self.process(claim)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                self.last_error = (
                    error.code
                    if isinstance(error, AutomationAPIError)
                    else "CHECKPOINT_UNAVAILABLE"
                    if isinstance(error, (sqlite3.Error, OSError))
                    else "INTERNAL_ERROR"
                )
            await asyncio.sleep(self.scan_seconds)

    async def _delete_and_ack(self, claim):
        await self.checkpointer.permanently_delete(f"automation:{claim.jobId}")
        await bounded_request(lambda: self.client.cleanup_complete(claim))
        self.last_deleted_at = int(time.time() * 1000)

    async def _renew(self, claim):
        while True:
            await asyncio.sleep(self.renew_seconds)
            await self.client.cleanup_renew(claim)

    async def process(self, claim):
        operation = asyncio.create_task(
            self._delete_and_ack(claim), name="career-checkpoint-delete"
        )
        renewal = asyncio.create_task(self._renew(claim), name="career-cleanup-lease")
        try:
            async with asyncio.timeout(self.timeout_seconds):
                done, _ = await asyncio.wait(
                    {operation, renewal}, return_when=asyncio.FIRST_COMPLETED
                )
                if renewal in done and operation not in done:
                    await renewal
                    raise AutomationAPIError("LEASE_LOST", lease_lost=True)
                await operation
        except AutomationAPIError as error:
            if not error.lease_lost:
                raise
        finally:
            for task in (operation, renewal):
                task.cancel()
            await asyncio.gather(operation, renewal, return_exceptions=True)
