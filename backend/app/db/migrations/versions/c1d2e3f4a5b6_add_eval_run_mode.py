"""add eval_runs.mode (bare vs grounded)

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-06-30 18:30:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c1d2e3f4a5b6'
down_revision: str | None = 'b0c1d2e3f4a5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('eval_runs', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('mode', sa.String(length=12), nullable=False, server_default='bare')
        )


def downgrade() -> None:
    with op.batch_alter_table('eval_runs', schema=None) as batch_op:
        batch_op.drop_column('mode')
