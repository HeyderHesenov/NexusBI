"""add confidence + provenance to query_logs (Answer Trust Badge)

Revision ID: b1c2d3e4f5a6
Revises: a8b9c0d1e2f3
Create Date: 2026-07-11 12:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: str | None = 'a8b9c0d1e2f3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Additive + nullable: rows logged before this feature keep NULL, and the UI
    # renders no trust badge for them (honest — their true provenance is unknown).
    op.add_column('query_logs', sa.Column('confidence', sa.Float(), nullable=True))
    op.add_column('query_logs', sa.Column('provenance', sa.String(length=24), nullable=True))


def downgrade() -> None:
    op.drop_column('query_logs', 'provenance')
    op.drop_column('query_logs', 'confidence')
