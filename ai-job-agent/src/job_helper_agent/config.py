from pydantic import BaseModel, ConfigDict, Field


class AgentConfig(BaseModel):
    """Validated process configuration for the read-only Phase 1 service."""

    model_config = ConfigDict(frozen=True)

    service_name: str = Field(default="job-helper-agent", min_length=1)
    policy_version: str = Field(default="read-only-keywords-v1", min_length=1)


def load_config() -> AgentConfig:
    return AgentConfig()
