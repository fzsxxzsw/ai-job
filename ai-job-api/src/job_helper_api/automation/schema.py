from sqlalchemy import (
    BigInteger,
    Column,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import LONGTEXT, VARCHAR

TABLES = ("automation_job", "automation_action", "automation_action_event")


def automation_metadata() -> MetaData:
    metadata = MetaData()
    long = Text().with_variant(LONGTEXT(), "mysql")

    def key(size=128):
        return String(size).with_variant(VARCHAR(size, collation="utf8mb4_bin"), "mysql")

    def base():
        return [
            Column("id", key(36), primary_key=True),
            Column("user_id", BigInteger, nullable=False),
        ]

    Table(
        "automation_job",
        metadata,
        *base(),
        Column("business_key", key(64), nullable=False),
        Column("kind", String(24), nullable=False),
        Column("platform_account", key(255), nullable=False),
        Column("conversation_key", key(255)),
        Column("encrypt_job_id", key(255)),
        Column("boss_id", key(255)),
        Column("revision", BigInteger, nullable=False),
        Column("input_hash", String(64), nullable=False),
        Column("input_json", long, nullable=False),
        Column("context_json", long, nullable=False),
        Column("status", String(32), nullable=False),
        Column("phase", String(32), nullable=False),
        Column("phase_history_json", long, nullable=False),
        Column("available_at", BigInteger, nullable=False),
        Column("lease_token", key()),
        Column("lease_until", BigInteger),
        Column("attempts", Integer, nullable=False),
        Column("compute_started", Integer, nullable=False),
        Column("artifact_id", key(36)),
        Column("graph_finalized", Integer, nullable=False, server_default="1"),
        Column("artifact_json", long),
        Column("validation_hash", String(64)),
        Column("result_json", long),
        Column("result_id", key(36)),
        Column("last_error_code", String(64)),
        Column("created_at", BigInteger, nullable=False),
        Column("updated_at", BigInteger, nullable=False),
        UniqueConstraint("user_id", "business_key", name="uq_automation_job_business"),
        Index("ix_automation_job_claim", "user_id", "status", "available_at"),
    )
    Table(
        "automation_action",
        metadata,
        *base(),
        Column("job_id", key(36), nullable=False),
        Column("kind", String(24), nullable=False),
        Column("sequence", Integer, nullable=False),
        Column("status", String(24), nullable=False),
        Column("payload_json", long, nullable=False),
        Column("payload_hash", String(64), nullable=False),
        Column("approval_status", String(24), nullable=False),
        Column("approval_id", key(36)),
        Column("executor_id", key()),
        Column("lease_token", key()),
        Column("lease_until", BigInteger),
        Column("authorization_revision", BigInteger),
        Column("client_mid", key()),
        Column("server_mid", key()),
        Column("dispatch_token", key()),
        Column("last_error_code", String(64)),
        Column("finalized", Integer, nullable=False),
        Column("created_at", BigInteger, nullable=False),
        Column("updated_at", BigInteger, nullable=False),
        UniqueConstraint("job_id", "sequence", name="uq_automation_action_sequence"),
        UniqueConstraint("user_id", "client_mid", name="uq_automation_action_client_mid"),
        UniqueConstraint("user_id", "server_mid", name="uq_automation_action_server_mid"),
    )
    Table(
        "automation_action_event",
        metadata,
        *base(),
        Column("job_id", key(36)),
        Column("action_id", key(36)),
        Column("request_id", key(), nullable=False),
        Column("kind", String(24), nullable=False),
        Column("payload_hash", String(64), nullable=False),
        Column("payload_json", long, nullable=False),
        Column("created_at", BigInteger, nullable=False),
        UniqueConstraint("user_id", "request_id", name="uq_automation_event_request"),
    )
    return metadata
