"""Application settings loaded from environment via pydantic-settings."""
from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed application configuration. All values come from env / .env."""

    model_config = SettingsConfigDict(
        # Supports running from repo root (.env) or backend/ (../.env).
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ─── AI provider ───
    OPENAI_API_KEY: str = Field(default="")
    OPENAI_MODEL: str = Field(default="gpt-4o")

    # ─── OAuth ───
    GOOGLE_CLIENT_ID: str = Field(default="")

    # ─── Database ───
    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./nexusbi.db")

    # ─── Redis ───
    REDIS_URL: str = Field(default="redis://localhost:6379/0")
    CACHE_TTL_SECONDS: int = Field(default=300)  # query result cache TTL

    # ─── Datasource connection pooling ───
    DATASOURCE_POOL_SIZE: int = Field(default=5)
    DATASOURCE_POOL_MAX_OVERFLOW: int = Field(default=10)
    DATASOURCE_POOL_RECYCLE_SECONDS: int = Field(default=1800)
    DATASOURCE_MAX_ENGINES: int = Field(default=20)

    # ─── Security ───
    SECRET_KEY: str = Field(default="dev-insecure-change-me")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60)
    ALGORITHM: str = Field(default="HS256")
    FERNET_KEY: str = Field(default="")

    # ─── App ───
    DEMO_MODE: bool = Field(default=True)
    CORS_ORIGINS: str = Field(default="http://localhost:5173")

    # ─── Uploads (CSV/Excel datasources) ───
    UPLOAD_DIR: str = Field(default="./data/uploads")
    UPLOAD_MAX_BYTES: int = Field(default=10 * 1024 * 1024)  # 10 MB

    # ─── Scheduler (saved-query refresh) ───
    SCHEDULER_ENABLED: bool = Field(default=True)
    SCHEDULER_INTERVAL_SECONDS: int = Field(default=60)  # how often due jobs are checked

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()


settings = get_settings()
