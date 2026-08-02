"""datasources.rls_mode: flip the server default to 'strict'

f3a4b5c6d7e8 added the column with server_default='open' so an installed
deployment kept its behaviour under the migration, and left that default in
place. Only the Python-side model default is 'strict', which reaches exactly one
writer (datasource_service.create). Any INSERT that bypasses the ORM — a cloning
migration, a bulk import, an ops fix — would silently produce a fail-OPEN source.

Backfilled rows are deliberately untouched: this changes what the database does
in the absence of a value, not what any existing source means.

Revision ID: a0b1c2d3e4f5
Revises: f3a4b5c6d7e8
Create Date: 2026-08-02 18:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'a0b1c2d3e4f5'
down_revision: str | None = 'f3a4b5c6d7e8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # batch_alter_table because SQLite cannot ALTER a column in place.
    with op.batch_alter_table('datasources', schema=None) as batch_op:
        batch_op.alter_column(
            'rls_mode',
            existing_type=sa.String(length=16),
            existing_nullable=False,
            server_default='strict',
        )


def downgrade() -> None:
    with op.batch_alter_table('datasources', schema=None) as batch_op:
        batch_op.alter_column(
            'rls_mode',
            existing_type=sa.String(length=16),
            existing_nullable=False,
            server_default='open',
        )
