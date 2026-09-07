import asyncio
import json
import sqlite3
import threading
import time
from dataclasses import replace

from fastapi.testclient import TestClient

from job_helper_api.contracts import AskInput
from job_helper_api.database import Database
from job_helper_api.main import create_app
from job_helper_api.notifications import Notifier


def setup_mail(world):
    with sqlite3.connect(world["path"]) as connection:
        connection.execute(
            "UPDATE user_info SET email=?,preference=? WHERE id=3",
            ("owner@example.test", json.dumps({"ermE": True, "crE": True})),
        )
    return replace(
        world["settings"],
        mail_enabled=True,
        mail_host="smtp.example.test",
        mail_sender="sender@example.test",
    )


def test_notifications_default_to_disabled_without_contacting_smtp(world):
    sent = []
    notifier = Notifier(world["settings"], sent.append)
    asyncio.run(
        notifier.notify_conversation(
            None, 3, AskInput(jobKey="job", question="你好"), "你好", event_key="event"
        )
    )
    assert sent == []


def test_notifications_respect_owner_and_survive_restart_without_duplicate_send(world):
    settings = setup_mail(world)
    sent = []
    payload = AskInput(jobKey="job", question="可以安排面试吗", jobInfo={"jobTitle": "测试岗位"})

    async def run():
        for _ in range(2):
            db = Database(settings.database_url)
            await db.open()
            try:
                notifier = Notifier(settings, sent.append)
                await notifier.notify_conversation(
                    db, 3, payload, "可以沟通时间", high_interest=True, event_key="event"
                )
                await notifier.close()
            finally:
                await db.close()

    asyncio.run(run())
    assert len(sent) == 2
    assert all(message["To"] == "owner@example.test" for message in sent)
    assert {str(message["Subject"]) for message in sent} == {"每轮对话邮件通知", "高意向邮件通知"}


def test_smtp_failure_is_recorded_and_never_retried_automatically(world, caplog):
    settings = setup_mail(world)
    attempts = []

    def fail(message):
        attempts.append(message)
        raise OSError("private-smtp-password")

    async def run():
        db = Database(settings.database_url)
        await db.open()
        try:
            notifier = Notifier(settings, fail)
            payload = AskInput(jobKey="job", question="你好")
            for _ in range(2):
                await notifier.notify_conversation(db, 3, payload, "你好", event_key="event")
            await notifier.close()
        finally:
            await db.close()

    asyncio.run(run())
    assert len(attempts) == 1
    assert "private-smtp-password" not in caplog.text
    with sqlite3.connect(world["path"]) as connection:
        assert (
            connection.execute(
                "SELECT value_json FROM py_api_control WHERE control_key LIKE 'mail:round:%'"
            ).fetchone()[0]
            == '"failed"'
        )


def test_slow_smtp_never_delays_the_browser_reply(world):
    settings = setup_mail(world)
    world["fake"].output = "你好，可以进一步沟通"
    entered = threading.Event()
    release = threading.Event()

    def slow_mail(message):
        entered.set()
        release.wait(timeout=5)

    try:
        with TestClient(
            create_app(settings, world["transport"], mail_transport=slow_mail)
        ) as client:
            client.headers["Authorization"] = client.post(
                "/api/user/silently/login", params={"uniqueId": "boss-owner"}
            ).json()["data"]
            started = time.monotonic()
            response = client.post(
                "/api/job/seeker/cloned/ask", json={"jobKey": "slow-mail", "question": "你好"}
            )
            elapsed = time.monotonic() - started
            assert response.status_code == 200 and response.json()["data"]["answerContent"]
            assert elapsed < 1.5
            assert entered.wait(timeout=1)
            release.set()
    finally:
        release.set()
