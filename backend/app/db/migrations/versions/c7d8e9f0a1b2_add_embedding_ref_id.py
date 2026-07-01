"""add query_embeddings.ref_id (asset search)

Revision ID: c7d8e9f0a1b2
Revises: b6c7d8e9f0a1
Create Date: 2026-07-01 12:20:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d8e9f0a1b2'
down_revision: str | None = 'b6c7d8e9f0a1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('query_embeddings') as batch:
        batch.add_column(sa.Column('ref_id', sa.String(length=36), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('query_embeddings') as batch:
        batch.drop_column('ref_id')
