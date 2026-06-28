"""add requirement_docs table

Revision ID: e1f2a3b4c5d6
Revises: d0a1b2c3d4e5
Create Date: 2026-06-29 10:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'e1f2a3b4c5d6'
down_revision: str | None = 'd0a1b2c3d4e5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'requirement_docs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False, server_default=''),
        sa.Column('raw_text', sa.Text(), nullable=False, server_default=''),
        sa.Column('extracted_kpis', sa.JSON(), nullable=True),
        sa.Column('dashboard_id', sa.String(length=36), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['dashboard_id'], ['dashboards.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_requirement_docs_user_id', 'requirement_docs', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_requirement_docs_user_id', table_name='requirement_docs')
    op.drop_table('requirement_docs')
