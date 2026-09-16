from sqlalchemy import BigInteger, Column, Index, MetaData, String, Table, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT, VARCHAR

TABLES = (
    "career_resume_version",
    "career_application",
    "career_application_event",
    "career_resume_exposure",
    "career_resume_proposal",
    "career_strategy_plan",
)


def career_metadata():
    metadata = MetaData()
    long = Text().with_variant(LONGTEXT(), "mysql")

    def key(size=36):
        return String(size).with_variant(VARCHAR(size, collation="utf8mb4_bin"), "mysql")

    def base():
        return [
            Column("id", key(), primary_key=True),
            Column("user_id", BigInteger, nullable=False),
        ]

    Table(
        "career_resume_version",
        metadata,
        *base(),
        Column("parent_id", key()),
        Column("source", String(24), nullable=False),
        Column("content_hash", String(64), nullable=False),
        Column("data_json", long, nullable=False),
        Column("created_at", BigInteger, nullable=False),
        Index("ix_career_resume_owner_hash", "user_id", "content_hash"),
    )
    Table(
        "career_application",
        metadata,
        *base(),
        Column("application_key", key(64), nullable=False),
        Column("platform_account", key(255), nullable=False),
        Column("encrypt_job_id", key(255), nullable=False),
        Column("conversation_key", key(255)),
        Column("boss_id", key(255)),
        Column("cycle_key", key(128), nullable=False),
        Column("job_id", key()),
        Column("prepared_resume_version_id", key()),
        Column("strategy_plan_id", key()),
        Column("contacted_at", BigInteger),
        Column("origin", String(32), nullable=False, server_default="UNKNOWN"),
        Column("job_title", String(255)),
        Column("company_name", String(255)),
        Column("recruiter_name", String(255)),
        Column("salary_text", String(255)),
        Column("location_text", String(500)),
        Column("jd_text", long),
        Column("snapshot_completeness", String(16), nullable=False, server_default="PARTIAL"),
        Column("application_validity", String(16), nullable=False, server_default="UNKNOWN"),
        Column("validity_reason_code", String(64)),
        Column("validity_evidence_json", long),
        Column("validity_updated_at", BigInteger),
        Column("read_state", String(16), nullable=False, server_default="UNKNOWN"),
        Column("read_state_updated_at", BigInteger),
        Column("application_status", String(32), nullable=False, server_default="DISCOVERED"),
        Column("status_updated_at", BigInteger),
        Column("status_evidence_json", long),
        Column("first_observed_at", BigInteger),
        Column("data_json", long, nullable=False),
        Column("legacy_snapshot_id", BigInteger),
        Column("created_at", BigInteger, nullable=False),
        Column("updated_at", BigInteger, nullable=False, server_default="0"),
        UniqueConstraint("user_id", "application_key", name="uq_career_application_cycle"),
        Index("ix_career_application_cohort", "user_id", "contacted_at"),
        Index(
            "ix_career_application_status",
            "user_id",
            "application_status",
            "updated_at",
        ),
        Index(
            "ix_career_application_validity",
            "user_id",
            "application_validity",
            "updated_at",
        ),
        Index("ix_career_application_job", "user_id", "encrypt_job_id", "created_at"),
    )
    Table(
        "career_application_event",
        metadata,
        *base(),
        Column("application_id", key(), nullable=False),
        Column("event_type", String(32), nullable=False),
        Column("occurred_at", BigInteger, nullable=False),
        Column("confirmation", String(24), nullable=False),
        Column("evidence_json", long, nullable=False),
        Column("supersedes_event_id", key()),
        Column("created_at", BigInteger, nullable=False),
        Index("ix_career_event_timeline", "application_id", "occurred_at"),
    )
    Table(
        "career_resume_exposure",
        metadata,
        *base(),
        Column("application_id", key(), nullable=False),
        Column("event_id", key()),
        Column("resume_version_id", key()),
        Column("state", String(16), nullable=False),
        Column("verification_kind", String(32), nullable=False),
        Column("platform_resume_id", key(128)),
        Column("created_at", BigInteger, nullable=False),
        UniqueConstraint("event_id", name="uq_career_exposure_event"),
    )
    Table(
        "career_resume_proposal",
        metadata,
        *base(),
        Column("job_id", key(), nullable=False),
        Column("base_version_id", key(), nullable=False),
        Column("status", String(16), nullable=False),
        Column("data_json", long, nullable=False),
        Column("accepted_version_id", key()),
        Column("accept_hash", String(64)),
        Column("created_at", BigInteger, nullable=False),
    )
    Table(
        "career_strategy_plan",
        metadata,
        *base(),
        Column("job_id", key(), nullable=False),
        Column("status", String(16), nullable=False),
        Column("data_json", long, nullable=False),
        Column("preview_hash", String(64), nullable=False),
        Column("base_preference_hash", String(64), nullable=False),
        Column("approved_at", BigInteger),
        Column("applied_at", BigInteger),
        Column("created_at", BigInteger, nullable=False),
    )
    return metadata
