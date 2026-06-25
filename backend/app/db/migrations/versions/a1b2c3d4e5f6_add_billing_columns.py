"""add billing columns to users

Revision ID: a1b2c3d4e5f6
Revises: 0189ecef4246
Create Date: 2026-06-25 04:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: str | None = '0189ecef4246'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('subscription_tier', sa.String(length=20), nullable=False, server_default='free')
        )
        batch_op.add_column(
            sa.Column('ai_calls_used', sa.Integer(), nullable=False, server_default='0')
        )
        batch_op.add_column(
            sa.Column('usage_period_start', sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('usage_period_start')
        batch_op.drop_column('ai_calls_used')
        batch_op.drop_column('subscription_tier')
