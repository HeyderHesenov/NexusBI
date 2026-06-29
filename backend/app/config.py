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

    # ─── Power BI (Azure AD) ── empty creds => mock provider (no license needed)
    POWERBI_TENANT_ID: str = Field(default="")
    POWERBI_CLIENT_ID: str = Field(default="")
    POWERBI_CLIENT_SECRET: str = Field(default="")
    POWERBI_API_BASE: str = Field(default="https://api.powerbi.com/v1.0/myorg")
    POWERBI_MAX_ROWS: int = Field(default=10000)

    # ─── Database ───
    DATABASE_URL: str = Field(default="sqlite+aiosqlite:///./nexusbi.db")
    # App-DB connection pool (ignored for SQLite, which doesn't use a sized pool).
    APP_DB_POOL_SIZE: int = Field(default=10)
    APP_DB_POOL_MAX_OVERFLOW: int = Field(default=20)
    APP_DB_POOL_RECYCLE_SECONDS: int = Field(default=1800)

    # ─── Redis ───
    REDIS_URL: str = Field(default="redis://localhost:6379/0")
    CACHE_TTL_SECONDS: int = Field(default=300)  # query result cache TTL
    SQLGEN_CACHE_TTL_SECONDS: int = Field(default=900)  # NL→SQL generation cache TTL
    QUERY_TIMEOUT_SECONDS: int = Field(default=15)  # hard cap on a single SELECT

    # ─── Datasource connection pooling ───
    DATASOURCE_POOL_SIZE: int = Field(default=5)
    DATASOURCE_POOL_MAX_OVERFLOW: int = Field(default=10)
    DATASOURCE_POOL_RECYCLE_SECONDS: int = Field(default=1800)
    DATASOURCE_MAX_ENGINES: int = Field(default=20)

    # ─── Security ───
    # Empty by default: demo generates an ephemeral key at startup; production
    # must supply a strong value (enforced in app.main._assert_production_secrets).
    SECRET_KEY: str = Field(default="")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=60)
    ALGORITHM: str = Field(default="HS256")
    FERNET_KEY: str = Field(default="")
    # Optional bearer token to gate the Prometheus /metrics scrape endpoint.
    # Empty => /metrics is only reachable from loopback.
    METRICS_TOKEN: str = Field(default="")

    # ─── App ───
    DEMO_MODE: bool = Field(default=True)
    CORS_ORIGINS: str = Field(default="http://localhost:5173")

    # ─── Uploads (CSV/Excel datasources) ───
    UPLOAD_DIR: str = Field(default="./data/uploads")
    UPLOAD_MAX_BYTES: int = Field(default=10 * 1024 * 1024)  # 10 MB

    # ─── Scheduler (saved-query refresh) ───
    SCHEDULER_ENABLED: bool = Field(default=True)
    SCHEDULER_INTERVAL_SECONDS: int = Field(default=60)  # how often due jobs are checked

    # ─── Proactive AI digest (morning brief) ───
    DIGEST_ENABLED: bool = Field(default=True)
    DIGEST_HOUR_UTC: int = Field(default=6)  # hour (UTC) the daily brief is built
    DIGEST_MAX_ITEMS: int = Field(default=5)  # max highlights per brief

    # ─── Live dashboards (real-time auto-refresh + WS push) ───
    LIVE_REFRESH_ENABLED: bool = Field(default=True)
    LIVE_REFRESH_TICK_SECONDS: int = Field(default=4)  # loop wake cadence
    LIVE_DEMO_FEED: bool = Field(default=True)  # nudge demo data so numbers visibly move

    # ─── Agentic copilot ───
    COPILOT_MAX_STEPS: int = Field(default=8)  # hard cap on tool-calling loop iterations

    # ─── Stripe billing (config-gated; empty = mock upgrade only) ───
    STRIPE_SECRET_KEY: str = Field(default="")
    STRIPE_SUCCESS_URL: str = Field(default="http://localhost:5173/pricing?paid=1")
    STRIPE_CANCEL_URL: str = Field(default="http://localhost:5173/pricing")

    # ─── Workflow integrations (Slack / Teams / email) — mock-first ───
    # When False, channel deliveries are mocked (logged) so demo never makes
    # outbound calls. Set True in production with real webhook URLs / SMTP.
    INTEGRATIONS_LIVE: bool = Field(default=False)
    SMTP_HOST: str = Field(default="")
    SMTP_PORT: int = Field(default=587)
    SMTP_USERNAME: str = Field(default="")
    SMTP_PASSWORD: str = Field(default="")
    SMTP_FROM: str = Field(default="nexusbi@example.com")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()


settings = get_settings()
