"""add saved_queries table

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-25 17:10:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c3d4e5f6a7'
down_revision: str | None = 'a1b2c3d4e5f6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'saved_queries',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('nl_query', sa.Text(), nullable=False),
        sa.Column('datasource_id', sa.String(length=36), nullable=True),
        sa.Column('schedule', sa.String(length=20), nullable=False, server_default='off'),
        sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_query_log_id', sa.String(length=36), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['datasource_id'], ['datasources.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['last_query_log_id'], ['query_logs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('saved_queries', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_saved_queries_user_id'), ['user_id'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('saved_queries', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_saved_queries_user_id'))
    op.drop_table('saved_queries')
