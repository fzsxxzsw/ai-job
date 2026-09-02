import os
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator
from sqlalchemy import URL


class AgentConfig(BaseModel):
    """Validated process configuration. Secrets are never rendered in logs."""

    model_config = ConfigDict(frozen=True)

    service_name: str = Field(default="job-helper-agent", min_length=1)
    policy_version: str = Field(default="read-only-keywords-v1", min_length=1)
    graph_version: str = Field(default="recoverable-job-v1", min_length=1, max_length=32)
    persistence_enabled: bool = False
    checkpoint_path: Path = Path("/app/data/langgraph-checkpoints.sqlite3")
    database_url: SecretStr | None = None
    database_host: str | None = None
    database_port: int = Field(default=3306, ge=1, le=65535)
    database_user: str | None = None
    database_password: SecretStr | None = None
    database_name: str | None = None
    internal_token: SecretStr | None = None
    subject_ref: str = Field(default="local-installation", min_length=1, max_length=128)
    resume_lease_seconds: int = Field(default=30, ge=1, le=300)

    @model_validator(mode="after")
    def require_persistence_secrets(self) -> "AgentConfig":
        if not self.persistence_enabled:
            return self
        missing: list[str] = []
        has_url = self.database_url is not None and bool(
            self.database_url.get_secret_value().strip()
        )
        has_parts = all(
            (
                self.database_host,
                self.database_user,
                self.database_password is not None
                and self.database_password.get_secret_value(),
                self.database_name,
            )
        )
        if not has_url and not has_parts:
            missing.append("AGENT_DATABASE_URL")
        if self.internal_token is None or not self.internal_token.get_secret_value().strip():
            missing.append("AGENT_INTERNAL_TOKEN")
        if missing:
            raise ValueError(
                "persistent Agent API is enabled but required settings are missing: "
                + ", ".join(missing)
            )
        if len(self.internal_token.get_secret_value()) < 32:
            raise ValueError("AGENT_INTERNAL_TOKEN must contain at least 32 characters")
        return self

    def sqlalchemy_url(self) -> str | URL:
        if self.database_url is not None and self.database_url.get_secret_value().strip():
            return self.database_url.get_secret_value()
        return URL.create(
            drivername="mysql+asyncmy",
            username=self.database_user,
            password=self.database_password.get_secret_value(),
            host=self.database_host,
            port=self.database_port,
            database=self.database_name,
            query={"charset": "utf8mb4"},
        )


def load_config() -> AgentConfig:
    return AgentConfig(
        service_name=os.getenv("AGENT_SERVICE_NAME", "job-helper-agent"),
        policy_version=os.getenv("AGENT_POLICY_VERSION", "read-only-keywords-v1"),
        graph_version=os.getenv("AGENT_GRAPH_VERSION", "recoverable-job-v1"),
        persistence_enabled=os.getenv("AGENT_PERSISTENCE_ENABLED", "false").casefold()
        in {"1", "true", "yes", "on"},
        checkpoint_path=Path(
            os.getenv("AGENT_CHECKPOINT_PATH", "/app/data/langgraph-checkpoints.sqlite3")
        ),
        database_url=os.getenv("AGENT_DATABASE_URL") or None,
        database_host=os.getenv("AGENT_DB_HOST") or None,
        database_port=int(os.getenv("AGENT_DB_PORT", "3306")),
        database_user=os.getenv("AGENT_DB_USER") or None,
        database_password=os.getenv("AGENT_DB_PASSWORD") or None,
        database_name=os.getenv("AGENT_DB_NAME") or None,
        internal_token=os.getenv("AGENT_INTERNAL_TOKEN") or None,
        subject_ref=os.getenv("AGENT_SUBJECT_REF", "local-installation"),
        resume_lease_seconds=int(os.getenv("AGENT_RESUME_LEASE_SECONDS", "30")),
    )
