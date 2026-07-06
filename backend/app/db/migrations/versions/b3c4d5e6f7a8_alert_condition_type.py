"""add condition_type to alerts (static | anomaly)

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-07-06 20:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'b3c4d5e6f7a8'
down_revision: str | None = 'a2b3c4d5e6f7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('alerts', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('condition_type', sa.String(length=10), nullable=False, server_default='static')
        )


def downgrade() -> None:
    with op.batch_alter_table('alerts', schema=None) as batch_op:
        batch_op.drop_column('condition_type')
