import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from job_helper_api.config import Settings
from job_helper_api.main import create_app

SCHEMA = """
CREATE TABLE user_info(id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, email TEXT, preference TEXT,
 is_active INTEGER, unique_id TEXT, ai_seat_status INTEGER, invite_code TEXT, bind_invite_code TEXT,
 created_id INTEGER, updated_id INTEGER, created_date DATETIME, updated_date DATETIME);
CREATE TABLE user_resume(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, resume_content TEXT, resume_id TEXT,
 is_active INTEGER, created_id INTEGER, updated_id INTEGER, created_date DATETIME, updated_date DATETIME);
CREATE TABLE user_ai_config(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, provider INTEGER,
 model_name TEXT, api_key TEXT, base_url TEXT, completions_path TEXT, timeout INTEGER, test_passed INTEGER,
 status INTEGER, is_active INTEGER, user_prompt TEXT, created_id INTEGER, updated_id INTEGER,
 created_date DATETIME, updated_date DATETIME);
CREATE TABLE msg_session(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, session_key TEXT COLLATE BINARY,
 msg_context TEXT, ai_type INTEGER, status INTEGER, is_active INTEGER, created_id INTEGER, updated_id INTEGER,
 created_date DATETIME, updated_date DATETIME);
CREATE TABLE delivery_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, audit_id TEXT COLLATE BINARY,
 delivery_key TEXT, kind TEXT, status TEXT, job_title TEXT, content_hash TEXT, content_length INTEGER,
 attempts INTEGER, event_created_at INTEGER, event_updated_at INTEGER, boss_id TEXT, conversation_key TEXT,
 client_mid TEXT, server_mid TEXT, observation_count INTEGER, duplicate_count INTEGER,
 transition_count INTEGER, last_observed_at INTEGER, UNIQUE(user_id,audit_id));
CREATE TABLE job_application_snapshot(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, encrypt_job_id TEXT COLLATE BINARY,
 applied_at INTEGER, job_base_info TEXT, job_ext_info TEXT, jd_hash TEXT, resume_record_id INTEGER,
 resume_content TEXT, resume_hash TEXT, preference_snapshot TEXT, pre_match_result TEXT, created_at INTEGER,
 UNIQUE(user_id,encrypt_job_id));
CREATE TABLE rejection_analysis(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, application_snapshot_id INTEGER,
 encrypt_job_id TEXT, conversation_key TEXT, conversation_completeness TEXT, conversation_json TEXT,
 conversation_hash TEXT, analysis_json TEXT, status TEXT, analysis_source TEXT, model TEXT, prompt_version TEXT,
 corrected_reason TEXT, corrected_code TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE py_api_control(user_id INTEGER, control_key TEXT COLLATE BINARY, value_json TEXT, updated_at INTEGER,
 PRIMARY KEY(user_id,control_key));
CREATE TABLE py_api_request(user_id INTEGER, session_key TEXT COLLATE BINARY, request_hash TEXT, status TEXT,
 response_json TEXT, created_at INTEGER, updated_at INTEGER, PRIMARY KEY(user_id,session_key,request_hash));
"""


class FakeModel:
    def __init__(self):
        self.calls = []
        self.output = '{"filter": false, "reason": "岗位符合要求"}'
        self.status = 200
        self.exception = None

    def __call__(self, request):
        self.calls.append(json.loads(request.content))
        if self.exception:
            raise self.exception
        return httpx.Response(
            self.status, json={"choices": [{"message": {"content": self.output}}]}
        )


@pytest.fixture
def world(tmp_path):
    path = tmp_path / "api.sqlite"
    with sqlite3.connect(path) as c:
        c.executescript(SCHEMA)
        c.execute(
            "INSERT INTO user_info(id,phone,email,preference,is_active,unique_id,ai_seat_status) VALUES (3,'','','{\"pi\":15}',1,'boss-owner',1)"
        )
        c.execute(
            "INSERT INTO user_info(id,phone,email,preference,is_active,unique_id,ai_seat_status) VALUES (9,'private','secret@example.test','{}',1,'other-account',1)"
        )
        c.execute(
            "INSERT INTO user_resume(user_id,resume_content,resume_id,is_active) VALUES (3,'测试候选人，Python与Vue项目经验','resume-old',1)"
        )
    fake = FakeModel()
    settings = Settings(
        database_url="sqlite+aiosqlite:///" + path.as_posix(),
        signing_key="fixture-secret-" * 4,
        owner_user_id=3,
        model_key="provider-secret-never-echo",
        read_only=False,
        build_id="fixture-python-v1",
    )
    yield {"path": path, "fake": fake, "settings": settings, "transport": httpx.MockTransport(fake)}


@pytest.fixture
def client(world):
    with TestClient(create_app(world["settings"], world["transport"])) as c:
        token = c.post("/api/user/silently/login", params={"uniqueId": "boss-owner"}).json()["data"]
        c.headers["Authorization"] = token
        yield c
