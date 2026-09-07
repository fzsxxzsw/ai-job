import asyncio
import sqlite3

import pytest

from job_helper_api import users


def pdf_fixture(text):
    stream = ("BT /F1 12 Tf 72 720 Td (" + text + ") Tj ET").encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    result = b"%PDF-1.4\n"
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += str(i).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(result)
    result += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(
        f"{offset:010d} 00000 n \n".encode() for offset in offsets
    )
    return (
        result
        + b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"
        + str(xref).encode()
        + b"\n%%EOF"
    )


def test_pdf_import_local_and_non_destructive(client, world):
    r = client.post(
        "/api/user/import/resume",
        data={"uniqueId": "boss-owner", "resumeId": "resume-new"},
        files={
            "file": (
                "test.pdf",
                pdf_fixture("Fixture Candidate Python Vue candidate@example.test"),
                "application/pdf",
            )
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["email"] == "candidate@example.test"
    assert client.post("/api/user/userinfo").json()["data"]["resumeId"] == "resume-new"
    with sqlite3.connect(world["path"]) as c:
        assert c.execute("SELECT COUNT(*) FROM user_resume").fetchone()[0] == 2
        assert c.execute("SELECT COUNT(*) FROM user_resume WHERE is_active=1").fetchone()[0] == 1
    assert world["fake"].calls == []


def test_invalid_pdf_keeps_old_resume(client):
    r = client.post(
        "/api/user/import/resume",
        data={"uniqueId": "boss-owner", "resumeId": "bad"},
        files={"file": ("bad.pdf", b"not PDF", "application/pdf")},
    )
    assert r.status_code == 422
    assert client.post("/api/user/userinfo").json()["data"]["resumeId"] == "resume-old"


def test_cancelled_pdf_parse_stops_worker_and_preserves_cancellation(monkeypatch):
    class Worker:
        returncode = None
        killed = False

        async def communicate(self, data):
            await asyncio.Event().wait()

        def kill(self):
            self.killed = True
            self.returncode = -9

        async def wait(self):
            return self.returncode

    worker = Worker()

    async def create_worker(*args, **kwargs):
        return worker

    monkeypatch.setattr(asyncio, "create_subprocess_exec", create_worker)

    async def run():
        task = asyncio.create_task(users.parse_pdf(b"fixture"))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    assert worker.killed
