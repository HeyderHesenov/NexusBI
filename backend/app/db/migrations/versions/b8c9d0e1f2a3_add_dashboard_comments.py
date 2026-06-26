"""add dashboard_comments table

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-26 17:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b8c9d0e1f2a3'
down_revision: str | None = 'a7b8c9d0e1f2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'dashboard_comments',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('dashboard_id', sa.String(length=36), nullable=False),
        sa.Column('widget_id', sa.String(length=36), nullable=True),
        sa.Column('author_id', sa.String(length=36), nullable=True),
        sa.Column('author_name', sa.String(length=120), nullable=False, server_default=''),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False,
        ),
        sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['widget_id'], ['widgets.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('dashboard_comments', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_dashboard_comments_dashboard_id'), ['dashboard_id'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('dashboard_comments', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_dashboard_comments_dashboard_id'))
    op.drop_table('dashboard_comments')
