import logging
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]

logger = logging.getLogger(__name__)


def _load_env_file():
    """从 backend/.env 读取环境变量；已存在的环境变量优先，密钥不入日志。"""
    env_path = BACKEND_DIR / ".env"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        pass


_load_env_file()


class Settings:
    def __init__(self) -> None:
        self.host = os.environ.get("FORGE_HOST", "0.0.0.0")
        self.port = int(os.environ.get("FORGE_PORT", "8000"))
        self.redis_url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
        self.sqlite_path = os.environ.get(
            "SQLITE_PATH", str(BACKEND_DIR / "data" / "forgeguard.db")
        )
        self.model_api_key = os.environ.get("MODEL_API_KEY", "")
        self.model_base_url = os.environ.get("MODEL_BASE_URL", "").rstrip("/")
        self.model_name = os.environ.get("MODEL_NAME", "")
        self.guardian_model_name = (
            os.environ.get("GUARDIAN_MODEL_NAME", "") or self.model_name
        )
        self.quota_global_daily = int(os.environ.get("QUOTA_GLOBAL_DAILY", "1000"))
        self.quota_session_max = int(os.environ.get("QUOTA_SESSION_MAX", "60"))
        # 游客匿名放行：每工作区每日模型调用上限，以及同一 IP 的每日总量上限
        # （后者防止不断切换工作区绕过配额）。
        self.quota_guest_daily = int(os.environ.get("QUOTA_GUEST_DAILY", "20"))
        self.quota_guest_ip_daily = int(os.environ.get("QUOTA_GUEST_IP_DAILY", "60"))
        self.instance_max = int(os.environ.get("INSTANCE_MAX", "8"))
        self.session_ttl = int(os.environ.get("SESSION_TTL", "14400"))
        self.snapshot_mode = os.environ.get("SNAPSHOT_MODE", "auto")
        self.instance_ttl_minutes = int(os.environ.get("INSTANCE_TTL_MINUTES", "60"))
        self.l2_model_path = os.environ.get("L2_MODEL_PATH", "")
        self.cors_origins = [
            o.strip()
            for o in os.environ.get(
                "CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
            ).split(",")
            if o.strip()
        ]

    @property
    def model_configured(self) -> bool:
        return bool(self.model_base_url and self.model_api_key and self.model_name)


settings = Settings()


def get_settings() -> Settings:
    return settings