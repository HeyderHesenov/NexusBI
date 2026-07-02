"""add dashboard_snapshots (time machine)

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
Create Date: 2026-07-02 14:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'e9f0a1b2c3d4'
down_revision: str | None = 'd8e9f0a1b2c3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'dashboard_snapshots',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('dashboard_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('label', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('origin', sa.String(length=10), nullable=False, server_default='manual'),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_dashboard_snapshots_dashboard_id', 'dashboard_snapshots', ['dashboard_id'])
    op.create_index(
        'ix_dashboard_snapshots_dash_created', 'dashboard_snapshots', ['dashboard_id', 'created_at']
    )


def downgrade() -> None:
    op.drop_index('ix_dashboard_snapshots_dash_created', table_name='dashboard_snapshots')
    op.drop_index('ix_dashboard_snapshots_dashboard_id', table_name='dashboard_snapshots')
    op.drop_table('dashboard_snapshots')
