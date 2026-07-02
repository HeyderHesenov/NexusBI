"""add ml_models (AutoML studio)

Revision ID: a2b3c4d5e6f7
Revises: f0a1b2c3d4e5
Create Date: 2026-07-03 00:30:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a2b3c4d5e6f7'
down_revision: str | None = 'f0a1b2c3d4e5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'ml_models',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('source_table', sa.String(length=255), nullable=False),
        sa.Column('datasource_id', sa.String(length=36), nullable=True),
        sa.Column('target_column', sa.String(length=255), nullable=False),
        sa.Column('feature_columns', sa.JSON(), nullable=False),
        sa.Column('problem_type', sa.String(length=20), nullable=False),
        sa.Column('best_algo', sa.String(length=50), nullable=False),
        sa.Column('metrics', sa.JSON(), nullable=False),
        sa.Column('importances', sa.JSON(), nullable=False),
        sa.Column('model_blob', sa.LargeBinary(), nullable=False),
        sa.Column('sklearn_version', sa.String(length=20), nullable=False),
        sa.Column('row_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['datasource_id'], ['datasources.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_ml_models_user_id', 'ml_models', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_ml_models_user_id', table_name='ml_models')
    op.drop_table('ml_models')
