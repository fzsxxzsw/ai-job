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

TABLES = (
    "outcome_case",
    "outcome_observation",
    "outcome_job",
    "outcome_report",
    "outcome_feedback",
)


def outcome_metadata() -> MetaData:
    metadata = MetaData()
    ident = String(36)
    long_text = Text().with_variant(LONGTEXT(), "mysql")

    def key(length: int):
        return String(length).with_variant(VARCHAR(length, collation="utf8mb4_bin"), "mysql")

    def base():
        return [
            Column("id", ident, primary_key=True),
            Column("user_id", BigInteger, nullable=False),
        ]

    Table(
        "outcome_case",
        metadata,
        *base(),
        Column("case_key", key(64), nullable=False),
        Column("encrypt_job_id", key(255), nullable=False),
        Column("conversation_key", key(255)),
        Column("boss_id", key(80)),
        Column("revision", BigInteger, nullable=False),
        Column("facts_json", long_text, nullable=False),
        Column("current_report_id", ident),
        Column("status", String(32), nullable=False),
        Column("next_check_at", BigInteger),
        Column("last_observed_at", BigInteger, nullable=False),
        Column("last_verified_observation_at", BigInteger),
        Column("created_at", BigInteger, nullable=False),
        Column("updated_at", BigInteger, nullable=False),
        UniqueConstraint("user_id", "case_key", name="uq_outcome_case_owner_key"),
        Index("ix_outcome_case_due", "user_id", "next_check_at"),
    )
    Table(
        "outcome_observation",
        metadata,
        *base(),
        Column("event_id", key(128), nullable=False),
        Column("case_id", ident, nullable=False),
        Column("payload_hash", String(64), nullable=False),
        Column("source", String(40), nullable=False),
        Column("observed_at", BigInteger, nullable=False),
        Column("received_at", BigInteger, nullable=False),
        Column("payload_json", long_text, nullable=False),
        UniqueConstraint("user_id", "event_id", name="uq_outcome_observation_owner_event"),
    )
    Table(
        "outcome_job",
        metadata,
        *base(),
        Column("case_id", ident, nullable=False),
        Column("revision", BigInteger, nullable=False),
        Column("context_json", long_text),
        Column("input_hash", String(64)),
        Column("status", String(32), nullable=False),
        Column("phase", String(32), nullable=False),
        Column("phase_history_json", long_text, nullable=False),
        Column("available_at", BigInteger, nullable=False),
        Column("lease_token", String(128)),
        Column("lease_until", BigInteger),
        Column("attempts", Integer, nullable=False),
        Column("artifact_json", long_text),
        Column("artifact_id", ident),
        Column("validation_hash", String(64)),
        Column("report_id", ident),
        Column("feedback_id", ident),
        Column("last_error_code", String(64)),
        Column("created_at", BigInteger, nullable=False),
        Column("updated_at", BigInteger, nullable=False),
        UniqueConstraint("case_id", "revision", name="uq_outcome_job_case_revision"),
        Index("ix_outcome_job_claim", "user_id", "status", "available_at"),
    )
    Table(
        "outcome_report",
        metadata,
        *base(),
        Column("case_id", ident, nullable=False),
        Column("revision", BigInteger, nullable=False),
        Column("report_json", long_text, nullable=False),
        Column("feedback_status", String(32), nullable=False),
        Column("created_at", BigInteger, nullable=False),
        Column("updated_at", BigInteger, nullable=False),
        UniqueConstraint("case_id", "revision", name="uq_outcome_report_case_revision"),
    )
    Table(
        "outcome_feedback",
        metadata,
        *base(),
        Column("report_id", ident, nullable=False),
        Column("request_id", key(128), nullable=False),
        Column("payload_hash", String(64), nullable=False),
        Column("action", String(16), nullable=False),
        Column("corrected_outcome", String(32)),
        Column("corrected_reason", Text),
        Column("created_at", BigInteger, nullable=False),
        UniqueConstraint("user_id", "request_id", name="uq_outcome_feedback_owner_request"),
    )
    return metadata
