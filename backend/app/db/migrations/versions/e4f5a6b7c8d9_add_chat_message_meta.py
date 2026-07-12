"""add chat_messages.meta — structured AI plan/actions payload

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-07-12 18:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'e4f5a6b7c8d9'
down_revision: str | None = 'd3e4f5a6b7c8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('chat_messages', sa.Column('meta', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('chat_messages', 'meta')
