"""add cooldown_minutes to alerts

A breached threshold stays breached, so before this column every evaluation of a
saved query re-created the notification AND re-dispatched it to the user's Slack
/ webhook channels. Existing rows are given the same 60-minute default as new
ones rather than 0: the noise is the bug being fixed, so opting installed alerts
out of the fix would keep it.

Revision ID: b5c6d7e8f9a0
Revises: a0b1c2d3e4f5
Create Date: 2026-08-03 10:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'b5c6d7e8f9a0'
down_revision: str | None = 'a0b1c2d3e4f5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # batch_alter_table because SQLite cannot ALTER a column in place.
    with op.batch_alter_table('alerts', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('cooldown_minutes', sa.Integer(), nullable=False, server_default='60')
        )


def downgrade() -> None:
    with op.batch_alter_table('alerts', schema=None) as batch_op:
        batch_op.drop_column('cooldown_minutes')
