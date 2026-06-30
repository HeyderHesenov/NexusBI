"""add eval_runs.details (per-case breakdown)

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
Create Date: 2026-06-30 17:30:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b0c1d2e3f4a5'
down_revision: str | None = 'a9b0c1d2e3f4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('eval_runs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('details', sa.JSON(), nullable=False, server_default='[]'))


def downgrade() -> None:
    with op.batch_alter_table('eval_runs', schema=None) as batch_op:
        batch_op.drop_column('details')
