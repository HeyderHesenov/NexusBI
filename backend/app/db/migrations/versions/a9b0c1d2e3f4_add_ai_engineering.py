"""add AI engineering foundation (RAG vector index + eval runs)

Revision ID: a9b0c1d2e3f4
Revises: f8a9b0c1d2e3
Create Date: 2026-06-30 16:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a9b0c1d2e3f4'
down_revision: str | None = 'f8a9b0c1d2e3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'query_embeddings',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=True),
        sa.Column('datasource_id', sa.String(length=36), nullable=True),
        sa.Column('kind', sa.String(length=20), nullable=False, server_default='query'),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('sql', sa.Text(), nullable=True),
        sa.Column('embedding', sa.JSON(), nullable=False),
        sa.Column('dim', sa.Integer(), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False,
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('query_embeddings', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_query_embeddings_user_id'), ['user_id'], unique=False)

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
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('eval_runs')
    with op.batch_alter_table('query_embeddings', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_query_embeddings_user_id'))
    op.drop_table('query_embeddings')
