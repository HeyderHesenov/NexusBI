"""Async SQLAlchemy engine and session factory."""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

# SQLite uses a non-sized pool, so the pool_size/overflow knobs only apply to
# server databases (Postgres/MySQL). Configure them to avoid connection
# exhaustion under concurrent load in production.
_engine_kwargs: dict = {"echo": False, "pool_pre_ping": True, "future": True}
if not settings.DATABASE_URL.startswith("sqlite"):
    _engine_kwargs.update(
        pool_size=settings.APP_DB_POOL_SIZE,
        max_overflow=settings.APP_DB_POOL_MAX_OVERFLOW,
        pool_recycle=settings.APP_DB_POOL_RECYCLE_SECONDS,
    )
else:
    # SQLite (demo/dev): wait on the lock instead of erroring immediately when the
    # concurrent fan-out paths (auto-dashboard, requirements build, live refresh)
    # write from several sessions at once.
    _engine_kwargs["connect_args"] = {"timeout": 30}

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

def enforce_sqlite_foreign_keys(sync_engine: Any) -> None:
    """Turn on SQLite's foreign-key enforcement for every connection of an engine.

    SQLite ignores foreign keys unless this pragma is set, and it is PER CONNECTION,
    so it cannot live in a migration. Without it every `ondelete` the schema declares
    is silently inert on SQLite while it fires on Postgres: deleting a datasource on
    the demo/dev DB left ba_artifacts, decisions, saved_queries, ml_models and
    query_logs pointing at a row that no longer exists, and CASCADE children (metrics,
    data_contracts, workspace sources) simply outlived their parent.

    Exported because the test suite binds its own engine to the same database — the
    pragma has to be attached there too or the suite tests semantics the app doesn't
    actually have.
    """

    @event.listens_for(sync_engine, "connect")
    def _set_pragma(dbapi_connection: Any, _record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


if settings.DATABASE_URL.startswith("sqlite"):
    enforce_sqlite_foreign_keys(engine.sync_engine)


AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an async session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
