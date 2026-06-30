"""add metric_nodes (KPI decomposition tree)

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-07-01 12:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a5b6c7d8e9f0'
down_revision: str | None = 'f4a5b6c7d8e9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'metric_nodes',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('parent_id', sa.String(length=36), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('operator', sa.String(length=8), nullable=False, server_default='add'),
        sa.Column('manual_value', sa.Float(), nullable=True),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['parent_id'], ['metric_nodes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_metric_nodes_user_id', 'metric_nodes', ['user_id'])
    op.create_index('ix_metric_nodes_parent_id', 'metric_nodes', ['parent_id'])


def downgrade() -> None:
    op.drop_index('ix_metric_nodes_parent_id', table_name='metric_nodes')
    op.drop_index('ix_metric_nodes_user_id', table_name='metric_nodes')
    op.drop_table('metric_nodes')
