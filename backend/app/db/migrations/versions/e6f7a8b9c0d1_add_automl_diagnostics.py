"""add leaderboard + diagnostics columns to ml_models

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-07-10 12:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'e6f7a8b9c0d1'
down_revision: str | None = 'd5e6f7a8b9c0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('ml_models', schema=None) as batch_op:
        batch_op.add_column(sa.Column('leaderboard', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('diagnostics', sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('ml_models', schema=None) as batch_op:
        batch_op.drop_column('diagnostics')
        batch_op.drop_column('leaderboard')
