"""drop eval_runs (AI Quality / LLM eval feature removed)

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-07-11 09:05:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a8b9c0d1e2f3'
down_revision: str | None = 'f7a8b9c0d1e2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drops eval_runs only. query_embeddings (RAG vector store, created in the same
    # a9b0c1d2e3f4 migration) is deliberately left intact — the core Text2SQL path uses it.
    op.drop_table('eval_runs')


def downgrade() -> None:
    # Recreates eval_runs at its head shape (base a9b0c1d2e3f4 + details b0c1d2e3f4a5
    # + mode c1d2e3f4a5b6) so the feature can be fully restored.
    op.create_table(
        'eval_runs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('model', sa.String(length=100), nullable=False, server_default=''),
        sa.Column('total', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('passed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('exec_accuracy', sa.Float(), nullable=False, server_default='0'),
        sa.Column('avg_latency_ms', sa.Float(), nullable=False, server_default='0'),
        sa.Column('notes', sa.Text(), nullable=False, server_default=''),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False,
        ),
        sa.Column('details', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('mode', sa.String(length=12), nullable=False, server_default='bare'),
        sa.PrimaryKeyConstraint('id'),
    )
