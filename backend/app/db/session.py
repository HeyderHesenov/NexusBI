"""Async SQLAlchemy engine and session factory."""
from __future__ import annotations

from collections.abc import AsyncGenerator

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

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

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
