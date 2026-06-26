"""add composite index on saved_queries(schedule, last_run_at)

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-26 12:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = 'a7b8c9d0e1f2'
down_revision: str | None = 'f6a7b8c9d0e1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('saved_queries', schema=None) as batch_op:
        batch_op.create_index(
            'ix_saved_queries_schedule_last_run',
            ['schedule', 'last_run_at'],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table('saved_queries', schema=None) as batch_op:
        batch_op.drop_index('ix_saved_queries_schedule_last_run')
