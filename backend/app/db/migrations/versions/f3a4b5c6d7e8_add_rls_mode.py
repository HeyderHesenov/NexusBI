"""add datasources.rls_mode (RLS deny-by-default)

Existing sources are backfilled with 'open' so an installed deployment keeps its
current behaviour; newly created sources get 'strict' from the model default.

Revision ID: f3a4b5c6d7e8
Revises: f1a2b3c4d5e6
Create Date: 2026-07-31 17:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'f3a4b5c6d7e8'
down_revision: str | None = 'f1a2b3c4d5e6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('datasources', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('rls_mode', sa.String(length=16), nullable=False, server_default='open')
        )


def downgrade() -> None:
    with op.batch_alter_table('datasources', schema=None) as batch_op:
        batch_op.drop_column('rls_mode')
