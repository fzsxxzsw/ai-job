import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import URL


@dataclass(frozen=True)
class Settings:
    database_url: str | URL = field(repr=False)
    signing_key: str = field(repr=False)
    owner_user_id: int
    model_key: str = field(default="", repr=False)
    model_base: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model_name: str = "qwen3-vl-32b-thinking"
    completions_path: str = "/chat/completions"
    model_timeout: int = 15
    thinking_budget: int = 256
    build_id: str = "dev"
    version: str = "0.0.65"
    read_only: bool = True
    session_ttl: int = 43200
    allowed_model_hosts: tuple[str, ...] = ()
    admin_ids: tuple[int, ...] = (1,)
    confirmed_education: str = ""
    mail_enabled: bool = False
    mail_host: str = ""
    mail_port: int = 465
    mail_username: str = field(default="", repr=False)
    mail_password: str = field(default="", repr=False)
    mail_sender: str = ""
    mail_security: str = "ssl"
    mail_timeout: int = 10
    outcome_enabled: bool = False
    outcome_internal_token: str = field(default="", repr=False)
    outcome_read_wait_hours: int = 24
    outcome_unread_wait_hours: int = 72
    outcome_lease_seconds: int = 180

    def __post_init__(self):
        if self.owner_user_id <= 0:
            raise ValueError(
                "API_OWNER_USER_ID must bind this personal installation to an existing user"
            )
        if len(self.signing_key) < 32:
            raise ValueError("API_SESSION_SECRET must contain at least 32 characters")
        if not 3 <= self.model_timeout <= 120:
            raise ValueError("AI_TIMEOUT_SECONDS must be between 3 and 120")
        if not 60 <= self.session_ttl <= 604800:
            raise ValueError("API_SESSION_TTL_SECONDS must be between 60 and 604800")
        if not 0 <= self.thinking_budget <= 32768:
            raise ValueError("AI_THINKING_BUDGET must be between 0 and 32768")
        if not 1 <= self.mail_port <= 65535 or not 1 <= self.mail_timeout <= 30:
            raise ValueError("Invalid SMTP port or timeout")
        if self.mail_security not in {"ssl", "starttls"}:
            raise ValueError("API_MAIL_SECURITY must be ssl or starttls")
        if self.mail_enabled and (
            not self.mail_host or not self.mail_sender or "@" not in self.mail_sender
        ):
            raise ValueError("Enabled email notifications require SMTP host and sender")
        if any(c in self.mail_sender for c in "\r\n"):
            raise ValueError("Invalid SMTP sender")
        if self.outcome_enabled and len(self.outcome_internal_token) < 32:
            raise ValueError("API_OUTCOME_INTERNAL_TOKEN must contain at least 32 characters")
        if (
            not 1 <= self.outcome_read_wait_hours <= 720
            or not 1 <= self.outcome_unread_wait_hours <= 720
        ):
            raise ValueError("Outcome waiting thresholds must be between 1 and 720 hours")
        if not 30 <= self.outcome_lease_seconds <= 600:
            raise ValueError("Outcome lease must be between 30 and 600 seconds")


def load_settings() -> Settings:
    if os.getenv("JOB_HELPER_PERSONAL_MODE", "true").lower() != "true":
        raise ValueError(
            "Python API supports personal mode only; use the archived Java release for sales"
        )
    secret = os.getenv("API_SESSION_SECRET", "")
    if not secret:
        secret_path = Path(os.getenv("API_SECRET_FILE", "/app/data/session.key"))
        secret_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with secret_path.open("x", encoding="ascii") as f:
                f.write(secrets.token_urlsafe(48))
            secret_path.chmod(0o600)
        except FileExistsError:
            pass
        secret = secret_path.read_text(encoding="ascii").strip()
    password = os.environ.get("MYSQL_PASSWORD")
    if not password:
        raise ValueError("MYSQL_PASSWORD is required")
    url = URL.create(
        "mysql+asyncmy",
        username=os.getenv("API_DB_USER", "ai_job"),
        password=password,
        host=os.getenv("API_DB_HOST", "mysql"),
        port=int(os.getenv("API_DB_PORT", "3306")),
        database=os.getenv("API_DB_NAME", "ai_job"),
        query={"charset": "utf8mb4"},
    )
    return Settings(
        database_url=url,
        signing_key=secret,
        owner_user_id=int(os.environ["API_OWNER_USER_ID"]),
        model_key=os.getenv("AI_API_KEY", ""),
        model_base=os.getenv("AI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        model_name=os.getenv("AI_MODEL", "qwen3-vl-32b-thinking"),
        completions_path=os.getenv("AI_COMPLETIONS_PATH", "/chat/completions"),
        model_timeout=int(os.getenv("AI_TIMEOUT_SECONDS", "15")),
        thinking_budget=int(os.getenv("AI_THINKING_BUDGET", "256")),
        build_id=os.getenv("JOB_HELPER_BUILD_ID", "dev"),
        version=os.getenv("JOB_HELPER_VERSION", "0.0.65"),
        read_only=os.getenv("API_READ_ONLY", "true").lower() != "false",
        session_ttl=int(os.getenv("API_SESSION_TTL_SECONDS", "43200")),
        confirmed_education=os.getenv("API_CONFIRMED_EDUCATION", ""),
        allowed_model_hosts=tuple(
            x.strip() for x in os.getenv("API_ALLOWED_MODEL_HOSTS", "").split(",") if x.strip()
        ),
        mail_enabled=os.getenv("API_MAIL_ENABLED", "false").lower() == "true",
        mail_host=os.getenv("API_MAIL_HOST", ""),
        mail_port=int(os.getenv("API_MAIL_PORT", "465")),
        mail_username=os.getenv("API_MAIL_USERNAME", ""),
        mail_password=os.getenv("API_MAIL_PASSWORD", ""),
        mail_sender=os.getenv("API_MAIL_SENDER", ""),
        mail_security=os.getenv("API_MAIL_SECURITY", "ssl"),
        mail_timeout=int(os.getenv("API_MAIL_TIMEOUT_SECONDS", "10")),
        outcome_enabled=os.getenv("API_OUTCOME_ENABLED", "false").lower() == "true",
        outcome_internal_token=os.getenv("API_OUTCOME_INTERNAL_TOKEN", ""),
        outcome_read_wait_hours=int(os.getenv("API_OUTCOME_READ_WAIT_HOURS", "24")),
        outcome_unread_wait_hours=int(os.getenv("API_OUTCOME_UNREAD_WAIT_HOURS", "72")),
        outcome_lease_seconds=int(os.getenv("API_OUTCOME_LEASE_SECONDS", "180")),
    )
