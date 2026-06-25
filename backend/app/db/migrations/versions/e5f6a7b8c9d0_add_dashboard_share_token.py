"""add dashboard share_token

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-26 10:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a7b8c9d0'
down_revision: str | None = 'd4e5f6a7b8c9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('dashboards', schema=None) as batch_op:
        batch_op.add_column(sa.Column('share_token', sa.String(length=64), nullable=True))
        batch_op.create_index(
            batch_op.f('ix_dashboards_share_token'), ['share_token'], unique=True
        )


def downgrade() -> None:
    with op.batch_alter_table('dashboards', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_dashboards_share_token'))
        batch_op.drop_column('share_token')
