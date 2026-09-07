"""Rejection business schema, carried forward from the Java gateway migration."""

from sqlalchemy import BigInteger, Column, Integer, MetaData, String, Table, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT, VARCHAR


def rejection_metadata() -> MetaData:
    metadata = MetaData()
    ident = BigInteger().with_variant(Integer, "sqlite")
    long_text = Text().with_variant(LONGTEXT(), "mysql")
    job_id = String(255).with_variant(VARCHAR(255, collation="utf8mb4_bin"), "mysql")
    Table(
        "job_application_snapshot",
        metadata,
        Column("id", ident, primary_key=True, autoincrement=True),
        Column("user_id", BigInteger, nullable=False),
        Column("encrypt_job_id", job_id, nullable=False),
        Column("applied_at", BigInteger, nullable=False),
        Column("job_base_info", long_text),
        Column("job_ext_info", long_text),
        Column("jd_hash", String(64), nullable=False),
        Column("resume_record_id", BigInteger, nullable=False),
        Column("resume_content", long_text, nullable=False),
        Column("resume_hash", String(64), nullable=False),
        Column("preference_snapshot", long_text),
        Column("pre_match_result", long_text),
        Column("created_at", BigInteger, nullable=False),
        UniqueConstraint("user_id", "encrypt_job_id", name="uq_snapshot_user_job"),
    )
    Table(
        "rejection_analysis",
        metadata,
        Column("id", ident, primary_key=True, autoincrement=True),
        Column("user_id", BigInteger, nullable=False),
        Column("application_snapshot_id", BigInteger, nullable=True),
        Column("encrypt_job_id", job_id, nullable=False),
        Column("conversation_key", String(255)),
        Column("conversation_completeness", String(32), nullable=False),
        Column("conversation_json", long_text, nullable=False),
        Column("conversation_hash", String(64), nullable=False),
        Column("analysis_json", long_text, nullable=False),
        Column("status", String(32), nullable=False),
        Column("analysis_source", String(32), nullable=False),
        Column("model", String(160), nullable=False),
        Column("prompt_version", String(64), nullable=False),
        Column("corrected_reason", String(1000)),
        Column("corrected_code", String(80)),
        Column("created_at", BigInteger, nullable=False),
        Column("updated_at", BigInteger, nullable=False),
    )
    return metadata
