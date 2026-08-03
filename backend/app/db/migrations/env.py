"""Alembic environment — async-aware, autogenerate from model metadata."""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy.pool import NullPool

from app.config import settings
from app.db.migration_lock import lock_migrations
from app.models import Base  # noqa: F401  (registers all models)

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,
        # Both default to off, and both are on in scripts/check_schema_drift.py.
        # They have to match: the guard audits for differences autogenerate is
        # not even looking for, so with them off here every new NOT NULL column
        # would land in the database with a server_default the model never
        # declares — new drift the guard then demands a new baseline line for.
        # The ratchet could only ever grow. Fixing it at the point migrations are
        # produced is what lets the list shrink.
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        # Inside the transaction on purpose: the lock is transaction-scoped, so
        # it is released by the same commit or rollback that ends this run.
        lock_migrations(connection)
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        {"sqlalchemy.url": settings.DATABASE_URL},
        prefix="sqlalchemy.",
        poolclass=NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
