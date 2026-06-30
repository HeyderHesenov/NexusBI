"""add notifications.category + backfill from title

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-06-30 20:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'd2e3f4a5b6c7'
down_revision: str | None = 'c1d2e3f4a5b6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Backfill existing rows by the title conventions used before the column existed.
# Patterns are mutually disjoint prefixes, so order doesn't matter. Any row that
# matches none (e.g. an old "Smart Insight: …") intentionally keeps the
# server_default 'insight'.
_BACKFILL = [
    ("digest", "🌅%"),
    ("kpi_alert", "Alert:%"),
    ("ai_quality", "⚠️ AI%"),
    ("decision", "🎯%"),
    ("decision", "⚠️ Qərar%"),
    ("mention", "Səni qeyd%"),
]


def upgrade() -> None:
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('category', sa.String(length=20), nullable=False, server_default='insight')
        )
    notifications = sa.table(
        'notifications', sa.column('category', sa.String), sa.column('title', sa.String)
    )
    for category, pattern in _BACKFILL:
        op.execute(
            notifications.update()
            .where(notifications.c.title.like(pattern))
            .values(category=category)
        )


def downgrade() -> None:
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_column('category')
