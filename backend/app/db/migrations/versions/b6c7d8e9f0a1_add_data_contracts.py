"""add data_contracts + contract_runs

Revision ID: b6c7d8e9f0a1
Revises: a5b6c7d8e9f0
Create Date: 2026-07-01 13:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b6c7d8e9f0a1'
down_revision: str | None = 'a5b6c7d8e9f0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'data_contracts',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('datasource_id', sa.String(length=36), nullable=False),
        sa.Column('table_name', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('expectations', sa.JSON(), nullable=False),
        sa.Column('schema_hash', sa.String(length=64), nullable=True),
        sa.Column('last_status', sa.String(length=12), nullable=False, server_default='unknown'),
        sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['datasource_id'], ['datasources.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_data_contracts_user_id', 'data_contracts', ['user_id'])
    op.create_index('ix_data_contracts_datasource_id', 'data_contracts', ['datasource_id'])

    op.create_table(
        'contract_runs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('contract_id', sa.String(length=36), nullable=False),
        sa.Column('status', sa.String(length=12), nullable=False),
        sa.Column('results', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['contract_id'], ['data_contracts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_contract_runs_contract_id', 'contract_runs', ['contract_id'])


def downgrade() -> None:
    op.drop_index('ix_contract_runs_contract_id', table_name='contract_runs')
    op.drop_table('contract_runs')
    op.drop_index('ix_data_contracts_datasource_id', table_name='data_contracts')
    op.drop_index('ix_data_contracts_user_id', table_name='data_contracts')
    op.drop_table('data_contracts')
