"""add ba_artifacts.datasource_id (evidence + action promotion)

Revision ID: a4b5c6d7e8f9
Revises: f5a6b7c8d9e0
Create Date: 2026-07-25 12:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a4b5c6d7e8f9'
down_revision: str | None = 'f5a6b7c8d9e0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Batch mode: SQLite cannot ALTER TABLE ADD CONSTRAINT, so the FK needs a
    # table rebuild (same as the decisions datasource_id migration).
    with op.batch_alter_table('ba_artifacts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('datasource_id', sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            'fk_ba_artifacts_datasource_id', 'datasources', ['datasource_id'], ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    with op.batch_alter_table('ba_artifacts', schema=None) as batch_op:
        batch_op.drop_constraint('fk_ba_artifacts_datasource_id', type_='foreignkey')
        batch_op.drop_column('datasource_id')
