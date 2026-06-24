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

    # ─── Database ───
    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./nexusbi.db")

    # ─── Redis ───
    REDIS_URL: str = Field(default="redis://localhost:6379/0")

    # ─── Security ───
    SECRET_KEY: str = Field(default="dev-insecure-change-me")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60)
    ALGORITHM: str = Field(default="HS256")
    FERNET_KEY: str = Field(default="")

    # ─── App ───
    DEMO_MODE: bool = Field(default=True)
    CORS_ORIGINS: str = Field(default="http://localhost:5173")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()


settings = get_settings()
