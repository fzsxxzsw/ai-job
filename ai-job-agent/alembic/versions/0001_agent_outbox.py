"""Create the recoverable Agent facts and queued action outbox.

Revision ID: 0001_agent_outbox
Revises:
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "0001_agent_outbox"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_run",
        sa.Column("run_id", sa.String(36), primary_key=True),
        sa.Column("thread_id", sa.String(36), nullable=False),
        sa.Column("subject_ref", sa.String(128), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("input_json", mysql.JSON(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("decision", sa.String(16)),
        sa.Column("proposal_id", sa.String(36)),
        sa.Column("proposal_json", mysql.JSON()),
        sa.Column("preview_hash", sa.String(64)),
        sa.Column("interrupt_id", sa.String(128)),
        sa.Column("result_json", mysql.JSON()),
        sa.Column("policy_version", sa.String(64), nullable=False),
        sa.Column("graph_version", sa.String(32), nullable=False),
        sa.Column("last_event_seq", mysql.BIGINT(unsigned=True), nullable=False, server_default="0"),
        sa.Column("resume_token", sa.String(36)),
        sa.Column("resume_lease_until", mysql.DATETIME(fsp=6)),
        sa.Column("execution_token", sa.String(36)),
        sa.Column("execution_lease_until", mysql.DATETIME(fsp=6)),
        sa.Column("row_version", mysql.BIGINT(unsigned=True), nullable=False, server_default="0"),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("completed_at", mysql.DATETIME(fsp=6)),
        sa.CheckConstraint(
            "status IN ('CREATED','RUNNING','WAITING_APPROVAL','COMPLETED','FAILED')",
            name="ck_agent_run_status",
        ),
        sa.UniqueConstraint("thread_id", name="uq_agent_run_thread"),
        sa.UniqueConstraint("proposal_id", name="uq_agent_run_proposal"),
        sa.UniqueConstraint("subject_ref", "request_id", name="uq_agent_run_subject_request"),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_table(
        "agent_event",
        sa.Column("event_id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("seq", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("dedupe_key", sa.String(191), nullable=False),
        sa.Column("payload_json", mysql.JSON(), nullable=False),
        sa.Column("correlation_id", sa.String(36)),
        sa.Column("causation_id", sa.String(36)),
        sa.Column("occurred_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.run_id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("run_id", "seq", name="uq_agent_event_run_seq"),
        sa.UniqueConstraint("dedupe_key", name="uq_agent_event_dedupe"),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_table(
        "agent_approval",
        sa.Column("approval_id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("proposal_id", sa.String(36), nullable=False),
        sa.Column("interrupt_id", sa.String(128), nullable=False),
        sa.Column("subject_ref", sa.String(128), nullable=False),
        sa.Column("decision_request_id", sa.String(36), nullable=False),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("preview_hash", sa.String(64), nullable=False),
        sa.Column("reason", sa.String(1000)),
        sa.Column("decided_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint("decision IN ('APPROVE','REJECT')", name="ck_agent_approval_decision"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.run_id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("proposal_id", name="uq_agent_approval_proposal"),
        sa.UniqueConstraint(
            "subject_ref", "decision_request_id", name="uq_agent_approval_request"
        ),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )
    op.create_table(
        "agent_action",
        sa.Column("action_id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("approval_id", sa.String(36), nullable=False),
        sa.Column("subject_ref", sa.String(128), nullable=False),
        sa.Column("action_kind", sa.String(32), nullable=False),
        sa.Column("target_ref", sa.String(128), nullable=False),
        sa.Column("payload_json", mysql.JSON(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("preview_hash", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("available_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint("action_kind = 'CONTACT_JOB'", name="ck_agent_action_kind"),
        sa.CheckConstraint("status = 'QUEUED'", name="ck_agent_action_status"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_run.run_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["approval_id"], ["agent_approval.approval_id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_agent_action_idempotency"),
        mysql_charset="utf8mb4",
        mysql_collate="utf8mb4_unicode_ci",
    )


def downgrade() -> None:
    op.drop_table("agent_action")
    op.drop_table("agent_approval")
    op.drop_table("agent_event")
    op.drop_table("agent_run")
