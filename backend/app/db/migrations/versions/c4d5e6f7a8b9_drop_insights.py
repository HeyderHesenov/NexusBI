"""drop insights (auto-discovery engine removed)

The standalone Insights ("Kəşflər") page duplicated the always-on StatFact chips
and the Morning brief digest, so the engine + page were removed. Drop its table.

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-07-08 12:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d5e6f7a8b9'
down_revision: str | None = 'b3c4d5e6f7a8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index('ix_insights_dedup_key', table_name='insights')
    op.drop_index('ix_insights_user_id', table_name='insights')
    op.drop_table('insights')


def downgrade() -> None:
    op.create_table(
        'insights',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('query_log_id', sa.String(length=36), nullable=True),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False, server_default=''),
        sa.Column('impact_score', sa.Float(), nullable=False, server_default='0'),
        sa.Column('dedup_key', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('dismissed', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['query_log_id'], ['query_logs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_insights_user_id', 'insights', ['user_id'])
    op.create_index('ix_insights_dedup_key', 'insights', ['dedup_key'])
