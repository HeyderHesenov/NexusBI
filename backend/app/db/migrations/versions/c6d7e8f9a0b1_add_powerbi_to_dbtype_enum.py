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
        return  # SQLite/MySQL store the Enum as a plain string: nothing to alter
    # IF NOT EXISTS keeps this safe on a database that was built by create_all
    # from the current models rather than by replaying migrations.
    op.execute("ALTER TYPE dbtype ADD VALUE IF NOT EXISTS 'powerbi'")


def downgrade() -> None:
    # Postgres cannot drop a value from an enum; rebuilding the type would mean
    # rewriting every dependent column to delete a label that is only additive.
    # Leaving it is harmless -- the model simply stops emitting it.
    pass
