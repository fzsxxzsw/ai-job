from dataclasses import dataclass, field
import os
from urllib.parse import urlsplit


@dataclass(frozen=True)
class RejectionConfig:
    enabled: bool = False
    secret: str = field(default='', repr=False)
    model_key: str = field(default='', repr=False)
    model_base: str = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    model_name: str = 'qwen3-vl-32b-thinking'
    model_path: str = '/chat/completions'
    model_timeout: float = 10.0
    thinking_budget: int = 256
    allowed_model_hosts: tuple[str, ...] = ()
    build_id: str = 'dev'

    def __post_init__(self):
        if self.enabled and (len(self.secret) < 32 or not self.secret.isascii()):
            raise ValueError('REJECTION_GATEWAY_SECRET requires at least 32 ASCII characters')
        if not 1 <= self.model_timeout <= 12:
            raise ValueError('Rejection model timeout must be within 1..12 seconds')

    @classmethod
    def from_env(cls):
        return cls(
            enabled=os.getenv('REJECTION_ENABLED', 'false').lower() == 'true',
            secret=os.getenv('REJECTION_GATEWAY_SECRET', ''),
            model_key=os.getenv('AI_API_KEY', ''),
            model_base=os.getenv('AI_BASE_URL', cls.model_base),
            model_name=os.getenv('AI_MODEL', cls.model_name),
            model_path=os.getenv('AI_COMPLETIONS_PATH', cls.model_path),
            model_timeout=float(os.getenv('REJECTION_MODEL_TIMEOUT_SECONDS', '10')),
            thinking_budget=int(os.getenv('AI_THINKING_BUDGET', '256')),
            allowed_model_hosts=tuple(x.strip() for x in os.getenv('REJECTION_ALLOWED_MODEL_HOSTS', '').split(',') if x.strip()),
            build_id=os.getenv('JOB_HELPER_BUILD_ID', 'dev'),
        )
