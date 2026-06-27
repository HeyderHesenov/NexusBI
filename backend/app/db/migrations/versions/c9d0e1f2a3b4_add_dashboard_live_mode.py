"""add live-mode columns to dashboards

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-06-27 09:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c9d0e1f2a3b4'
down_revision: str | None = 'b8c9d0e1f2a3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('dashboards', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'live_enabled', sa.Boolean(), nullable=False, server_default=sa.false()
            )
        )
        batch_op.add_column(
            sa.Column(
                'live_interval_seconds', sa.Integer(), nullable=False, server_default='8'
            )
        )


def downgrade() -> None:
    with op.batch_alter_table('dashboards', schema=None) as batch_op:
        batch_op.drop_column('live_interval_seconds')
        batch_op.drop_column('live_enabled')
