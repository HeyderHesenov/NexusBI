"""add report_subscriptions (scheduled PDF/Excel delivery)

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-07-01 12:35:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'd8e9f0a1b2c3'
down_revision: str | None = 'c7d8e9f0a1b2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'report_subscriptions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('saved_query_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('recipient', sa.String(length=320), nullable=False),
        sa.Column('format', sa.String(length=10), nullable=False, server_default='pdf'),
        sa.Column('schedule', sa.String(length=20), nullable=False, server_default='daily'),
        sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['saved_query_id'], ['saved_queries.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_report_subscriptions_saved_query_id', 'report_subscriptions', ['saved_query_id'])
    op.create_index('ix_report_subscriptions_user_id', 'report_subscriptions', ['user_id'])
    op.create_index(
        'ix_report_subscriptions_active_last_sent', 'report_subscriptions', ['active', 'last_sent_at']
    )


def downgrade() -> None:
    op.drop_index('ix_report_subscriptions_active_last_sent', table_name='report_subscriptions')
    op.drop_index('ix_report_subscriptions_user_id', table_name='report_subscriptions')
    op.drop_index('ix_report_subscriptions_saved_query_id', table_name='report_subscriptions')
    op.drop_table('report_subscriptions')
