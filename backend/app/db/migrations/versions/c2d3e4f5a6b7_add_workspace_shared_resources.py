"""add workspace shared resources (dashboards + datasources shared to a team)

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-07-12 16:10:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c2d3e4f5a6b7'
down_revision: str | None = 'b1c2d3e4f5a6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'workspace_resources',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('resource_type', sa.String(length=20), nullable=False),
        sa.Column('resource_id', sa.String(length=36), nullable=False),
        sa.Column('shared_by', sa.String(length=36), nullable=False),
        sa.Column('permission', sa.String(length=10), nullable=False, server_default='view'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['shared_by'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'resource_type', 'resource_id', name='uq_ws_resource'),
    )
    op.create_index(
        'ix_workspace_resources_workspace_id', 'workspace_resources', ['workspace_id']
    )
    op.create_index(
        'ix_workspace_resources_resource_id', 'workspace_resources', ['resource_id']
    )
    op.create_index(
        'ix_workspace_resources_shared_by', 'workspace_resources', ['shared_by']
    )


def downgrade() -> None:
    op.drop_index('ix_workspace_resources_shared_by', table_name='workspace_resources')
    op.drop_index('ix_workspace_resources_resource_id', table_name='workspace_resources')
    op.drop_index('ix_workspace_resources_workspace_id', table_name='workspace_resources')
    op.drop_table('workspace_resources')
