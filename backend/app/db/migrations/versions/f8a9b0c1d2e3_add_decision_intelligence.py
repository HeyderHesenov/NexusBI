"""add decision intelligence loop (metric binding + measurements)

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-06-30 14:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'f8a9b0c1d2e3'
down_revision: str | None = 'e7f8a9b0c1d2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('decisions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('metric_query', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('metric_column', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('datasource_id', sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column('predicted_value', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('predicted_direction', sa.String(length=10), nullable=True))
        batch_op.add_column(sa.Column('baseline_value', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('baseline_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('realized_value', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('realized_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(
            sa.Column('measure_cadence', sa.String(length=10), nullable=False, server_default='off')
        )
        batch_op.add_column(sa.Column('last_query_log_id', sa.String(length=36), nullable=True))
        batch_op.add_column(
            sa.Column('impact_status', sa.String(length=20), nullable=False, server_default='pending')
        )
        batch_op.create_foreign_key(
            'fk_decisions_datasource_id', 'datasources', ['datasource_id'], ['id'],
            ondelete='SET NULL',
        )
        batch_op.create_foreign_key(
            'fk_decisions_last_query_log_id', 'query_logs', ['last_query_log_id'], ['id'],
            ondelete='SET NULL',
        )

    op.create_table(
        'decision_measurements',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('decision_id', sa.String(length=36), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('measured_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('query_log_id', sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(['decision_id'], ['decisions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['query_log_id'], ['query_logs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('decision_measurements', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_decision_measurements_decision_id'), ['decision_id'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('decision_measurements', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_decision_measurements_decision_id'))
    op.drop_table('decision_measurements')

    with op.batch_alter_table('decisions', schema=None) as batch_op:
        batch_op.drop_constraint('fk_decisions_last_query_log_id', type_='foreignkey')
        batch_op.drop_constraint('fk_decisions_datasource_id', type_='foreignkey')
        for col in (
            'impact_status', 'last_query_log_id', 'measure_cadence', 'realized_at',
            'realized_value', 'baseline_at', 'baseline_value', 'predicted_direction',
            'predicted_value', 'datasource_id', 'metric_column', 'metric_query',
        ):
            batch_op.drop_column(col)
