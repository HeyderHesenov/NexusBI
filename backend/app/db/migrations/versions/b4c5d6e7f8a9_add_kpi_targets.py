"""add kpi_targets table

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-06-29 13:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b4c5d6e7f8a9'
down_revision: str | None = 'a3b4c5d6e7f8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'kpi_targets',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('target_value', sa.Float(), nullable=False, server_default='0'),
        sa.Column('current_value', sa.Float(), nullable=False, server_default='0'),
        sa.Column('period', sa.String(length=20), nullable=False, server_default='month'),
        sa.Column('period_start', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_kpi_targets_user_id', 'kpi_targets', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_kpi_targets_user_id', table_name='kpi_targets')
    op.drop_table('kpi_targets')
