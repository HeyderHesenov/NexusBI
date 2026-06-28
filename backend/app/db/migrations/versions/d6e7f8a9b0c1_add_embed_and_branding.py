"""add dashboard.embed_enabled + brand_configs

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-06-29 15:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'd6e7f8a9b0c1'
down_revision: str | None = 'c5d6e7f8a9b0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('dashboards', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('embed_enabled', sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.create_table(
        'brand_configs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('app_name', sa.String(length=120), nullable=False, server_default='NexusBI'),
        sa.Column('primary_color', sa.String(length=9), nullable=False, server_default='#0E9F6E'),
        sa.Column('logo_url', sa.String(length=2000), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )
    op.create_index('ix_brand_configs_user_id', 'brand_configs', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_brand_configs_user_id', table_name='brand_configs')
    op.drop_table('brand_configs')
    with op.batch_alter_table('dashboards', schema=None) as batch_op:
        batch_op.drop_column('embed_enabled')
