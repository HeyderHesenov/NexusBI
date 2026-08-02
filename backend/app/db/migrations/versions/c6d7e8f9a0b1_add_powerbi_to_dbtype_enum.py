"""add 'powerbi' to the dbtype enum

The initial migration created dbtype with three labels (postgresql, mysql,
sqlite). models/datasource.py later grew a fourth, ``powerbi``, and nothing ever
taught the database about it -- SQLAlchemy does not diff enum members, and
Alembic's autogenerate does not either.

SQLite renders an Enum as VARCHAR with no constraint, so every test and every
SQLite dev box accepted 'powerbi' and the gap stayed invisible. On Postgres the
same INSERT fails with

    invalid input value for enum dbtype: "powerbi"

which means POST /api/v1/datasource/connect-powerbi has been broken on every
Postgres deployment since Power BI support was added, while passing CI.

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-08-03 02:35:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = 'c6d7e8f9a0b1'
down_revision: str | None = 'b5c6d7e8f9a0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if op.get_bind().dialect.name != 'postgresql':
        # SQLite renders sa.Enum as VARCHAR, so there is no type to alter. This is
        # NOT a general "other dialects are fine" claim -- MySQL renders it as a
        # native ENUM and would need its own ALTER. The application database is
        # SQLite (dev) or Postgres (docker-compose.prod.yml, docs/deploy.md); MySQL
        # appears in this codebase only as a customer DATA SOURCE, never as our own.
        return
    # REQUIRES POSTGRES 12+. Alembic wraps the run in a transaction (env.py
    # do_run_migrations) and PostgresqlImpl is transactional_ddl, so this lands
    # inside BEGIN/COMMIT; before 12 that is rejected outright with "ALTER TYPE
    # ... ADD cannot run inside a transaction block" and takes the whole upgrade
    # down with it. 12 is not a new constraint -- docker-compose.prod.yml has
    # pinned postgres:15 since the stack existed -- but it was undocumented.
    #
    # autocommit_block() is the usual escape and is deliberately NOT used: it
    # commits the surrounding transaction, which would release the
    # pg_advisory_xact_lock that migration_lock.py takes for the run, so two
    # concurrent migrators could proceed past the mutex. A documented version
    # floor is cheaper than trading the lock away.
    #
    # Note for whoever adds the next label: on 12+ the new value still cannot be
    # USED by a later migration in the same run. Nothing here does.
    #
    # IF NOT EXISTS keeps this safe on a database built by create_all from the
    # current models rather than by replaying migrations.
    op.execute("ALTER TYPE dbtype ADD VALUE IF NOT EXISTS 'powerbi'")


def downgrade() -> None:
    # Postgres cannot drop a value from an enum; rebuilding the type would mean
    # rewriting every dependent column to delete a label that is only additive.
    # Leaving it is harmless -- the model simply stops emitting it.
    pass
