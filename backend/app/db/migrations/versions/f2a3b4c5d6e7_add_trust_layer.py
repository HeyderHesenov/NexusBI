"""add trust layer: metric verification + datasource freshness SLA

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-06-29 11:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'f2a3b4c5d6e7'
down_revision: str | None = 'e1f2a3b4c5d6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('metrics', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('verified', sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column('verified_by', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table('datasources', schema=None) as batch_op:
        batch_op.add_column(sa.Column('freshness_sla_hours', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('last_refreshed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('datasources', schema=None) as batch_op:
        batch_op.drop_column('last_refreshed_at')
        batch_op.drop_column('freshness_sla_hours')
    with op.batch_alter_table('metrics', schema=None) as batch_op:
        batch_op.drop_column('verified_at')
        batch_op.drop_column('verified_by')
        batch_op.drop_column('verified')
