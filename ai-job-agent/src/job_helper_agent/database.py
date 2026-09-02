from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    JSON,
    String,
    UniqueConstraint,
    select,
    text,
)
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


ALEMBIC_HEAD = "0001_agent_outbox"


class Base(DeclarativeBase):
    pass


class AgentRun(Base):
    __tablename__ = "agent_run"
    __table_args__ = (
        UniqueConstraint("subject_ref", "request_id", name="uq_agent_run_subject_request"),
        CheckConstraint(
            "status IN ('CREATED','RUNNING','WAITING_APPROVAL','COMPLETED','FAILED')",
            name="ck_agent_run_status",
        ),
    )

    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    thread_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    subject_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    input_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    decision: Mapped[str | None] = mapped_column(String(16))
    proposal_id: Mapped[str | None] = mapped_column(String(36), unique=True)
    proposal_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    preview_hash: Mapped[str | None] = mapped_column(String(64))
    interrupt_id: Mapped[str | None] = mapped_column(String(128))
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    graph_version: Mapped[str] = mapped_column(String(32), nullable=False)
    last_event_seq: Mapped[int] = mapped_column(mysql.BIGINT(unsigned=True), nullable=False, default=0)
    resume_token: Mapped[str | None] = mapped_column(String(36))
    resume_lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    execution_token: Mapped[str | None] = mapped_column(String(36))
    execution_lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))
    row_version: Mapped[int] = mapped_column(mysql.BIGINT(unsigned=True), nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=False))


class AgentEvent(Base):
    __tablename__ = "agent_event"
    __table_args__ = (
        UniqueConstraint("run_id", "seq", name="uq_agent_event_run_seq"),
        UniqueConstraint("dedupe_key", name="uq_agent_event_dedupe"),
    )

    event_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agent_run.run_id", ondelete="RESTRICT"), nullable=False
    )
    seq: Mapped[int] = mapped_column(mysql.BIGINT(unsigned=True), nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(191), nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    correlation_id: Mapped[str | None] = mapped_column(String(36))
    causation_id: Mapped[str | None] = mapped_column(String(36))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class AgentApproval(Base):
    __tablename__ = "agent_approval"
    __table_args__ = (
        UniqueConstraint("subject_ref", "decision_request_id", name="uq_agent_approval_request"),
        CheckConstraint("decision IN ('APPROVE','REJECT')", name="ck_agent_approval_decision"),
    )

    approval_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agent_run.run_id", ondelete="RESTRICT"), nullable=False
    )
    proposal_id: Mapped[str] = mapped_column(String(36), unique=True, nullable=False)
    interrupt_id: Mapped[str] = mapped_column(String(128), nullable=False)
    subject_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    decision_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    preview_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(1000))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


class AgentAction(Base):
    __tablename__ = "agent_action"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_agent_action_idempotency"),
        CheckConstraint("action_kind = 'CONTACT_JOB'", name="ck_agent_action_kind"),
        CheckConstraint("status = 'QUEUED'", name="ck_agent_action_status"),
    )

    action_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agent_run.run_id", ondelete="RESTRICT"), nullable=False
    )
    approval_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("agent_approval.approval_id", ondelete="RESTRICT"), nullable=False
    )
    subject_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    action_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    target_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    preview_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)


def create_engine_and_session(database_url: str | URL) -> tuple[AsyncEngine, async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(database_url, pool_pre_ping=True, pool_recycle=1800)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def migration_is_current(engine: AsyncEngine) -> bool:
    try:
        async with engine.connect() as connection:
            revision = await connection.scalar(
                text("SELECT version_num FROM alembic_version_agent LIMIT 1")
            )
        return revision == ALEMBIC_HEAD
    except Exception:
        return False


async def database_is_reachable(engine: AsyncEngine) -> bool:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_json(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def action_idempotency_key(subject_ref: str, source_job_ref: str) -> str:
    value = ["contact-job:v1", subject_ref, source_job_ref]
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
