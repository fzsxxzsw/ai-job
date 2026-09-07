"""Opt-in personal SMTP notifications, with durable at-most-once attempts.

SMTP has no idempotency key. We claim the event before contacting SMTP and never
retry ambiguous sends automatically, so a lost response cannot duplicate mail.
"""

import asyncio
import hashlib
import logging
import re
import smtplib
import ssl
from collections.abc import Callable
from email.message import EmailMessage

from .config import Settings
from .contracts import AskInput
from .database import Database, loads

log = logging.getLogger("job_helper_api.notifications")
MailTransport = Callable[[EmailMessage], None]


class Notifier:
    def __init__(self, settings: Settings, transport: MailTransport | None = None) -> None:
        self.settings = settings
        self.transport = transport or self._send_smtp
        self._queue: asyncio.Queue[tuple[Database, int, AskInput, str, bool, str]] = asyncio.Queue(
            32
        )
        self._workers: list[asyncio.Task[None]] = []
        self._closed = False

    def _send_smtp(self, message: EmailMessage) -> None:
        config = self.settings
        context = ssl.create_default_context()
        if config.mail_security == "ssl":
            connection = smtplib.SMTP_SSL(
                config.mail_host, config.mail_port, timeout=config.mail_timeout, context=context
            )
        else:
            connection = smtplib.SMTP(
                config.mail_host, config.mail_port, timeout=config.mail_timeout
            )
        with connection:
            if config.mail_security == "starttls":
                connection.starttls(context=context)
            if config.mail_username:
                connection.login(config.mail_username, config.mail_password)
            connection.send_message(message)

    async def notify_conversation(
        self,
        db: Database,
        uid: int,
        payload: AskInput,
        answer: str,
        *,
        high_interest: bool = False,
        event_key: str,
    ) -> None:
        if not self.settings.mail_enabled or self.settings.read_only or self._closed:
            return
        if not self._workers:
            self._workers = [asyncio.create_task(self._worker()) for _ in range(2)]
        try:
            self._queue.put_nowait(
                (db, uid, payload.model_copy(deep=True), answer, high_interest, event_key)
            )
        except asyncio.QueueFull:
            log.warning("notification_queue_full user_id=%s", uid)

    async def _worker(self) -> None:
        while True:
            db, uid, payload, answer, high_interest, event_key = await self._queue.get()
            try:
                await self._deliver_conversation(db, uid, payload, answer, high_interest, event_key)
            finally:
                self._queue.task_done()

    async def close(self, grace: float = 3) -> None:
        """Drain briefly before database shutdown; interrupted sends stay claimed."""
        self._closed = True
        try:
            await asyncio.wait_for(self._queue.join(), timeout=grace)
        except TimeoutError:
            log.warning("notification_shutdown_pending count=%s", self._queue.qsize())
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    async def _deliver_conversation(
        self,
        db: Database,
        uid: int,
        payload: AskInput,
        answer: str,
        high_interest: bool,
        event_key: str,
    ) -> None:
        try:
            user = await db.user(uid)
            if not user:
                return
            recipient = user.get("email") or ""
            if not re.fullmatch(r"[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+", recipient):
                return
            preference = loads(user.get("preference"), {})
            if not isinstance(preference, dict):
                return
            job_name = str((payload.jobInfo or {}).get("jobTitle") or "当前岗位")[:300]
            session_hash = hashlib.sha256(payload.jobKey.encode()).hexdigest()
            if preference.get("ermE") is True:
                event_hash = hashlib.sha256((payload.jobKey + ":" + event_key).encode()).hexdigest()
                await self._send_once(
                    db,
                    uid,
                    "mail:round:" + event_hash,
                    recipient,
                    "每轮对话邮件通知",
                    f"岗位：{job_name}\n\n对方：{payload.question}\n\n助手：{answer}",
                )
            if high_interest and preference.get("crE") is True:
                await self._send_once(
                    db,
                    uid,
                    "mail:interest:" + session_hash,
                    recipient,
                    "高意向邮件通知",
                    f"岗位：{job_name}\n\n对话已达到你设置的高意向条件，请查看会话并决定下一步。",
                )
        except Exception as error:
            # Notification failures must never turn a saved reply into a retry.
            log.warning("notification_failed user_id=%s type=%s", uid, type(error).__name__)

    async def _send_once(
        self, db: Database, uid: int, key: str, recipient: str, subject: str, content: str
    ) -> None:
        async with db.lock(uid, key):
            if await db.control(uid, key):
                return
            async with db.engine.begin() as connection:
                await db.set_control(connection, uid, key, "sending")
            message = EmailMessage()
            message["From"] = self.settings.mail_sender
            message["To"] = recipient
            message["Subject"] = subject
            message.set_content(content)
            status = "sent"
            try:
                await asyncio.to_thread(self.transport, message)
            except Exception as error:
                status = "failed"
                log.warning("smtp_failed user_id=%s type=%s", uid, type(error).__name__)
            async with db.engine.begin() as connection:
                await db.set_control(connection, uid, key, status)
