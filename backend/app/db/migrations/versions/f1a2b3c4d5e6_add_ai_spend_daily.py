"""add ai_spend_daily

Revision ID: f1a2b3c4d5e6
Revises: a4b5c6d7e8f9
Create Date: 2026-07-30 14:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'f1a2b3c4d5e6'
down_revision: str | None = 'a4b5c6d7e8f9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'ai_spend_daily',
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column('feature', sa.String(length=40), nullable=False),
        sa.Column('model', sa.String(length=80), nullable=False),
        sa.Column('calls', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('prompt_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('completion_tokens', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('micro_usd', sa.BigInteger(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('day', 'feature', 'model'),
    )


def downgrade() -> None:
    op.drop_table('ai_spend_daily')
