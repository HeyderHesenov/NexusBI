"""give metric_nodes leaves a provenance (manual assumption vs measured value)

A metric-tree leaf was always a hand-typed float in `manual_value`, and nothing
downstream could tell that apart from a measured number: the copilot tool
returned it as a KPI, and the Digital Twin's Monte Carlo / goal seek / tornado /
narrative all built confident output on top of it.

This adds the binding that lets a leaf be measured instead:

  source_kind    'manual' (default, what every existing row is) or 'query'
  saved_query_id the saved query whose LAST STORED RUN supplies the number
  value_column   which column of that result to read
  agg            how to reduce the column (sum/avg/min/max/last/count)

server_default='manual' is spelled here and in models/metric_node.py with the
same literal on purpose. scripts/check_schema_drift.py compares the two, and a
default declared on only one side is the shape that left `rls_mode` fail-open in
the schema the tests build (a0b1c2d3e4f5). Existing rows need the default anyway:
the column is NOT NULL and the table already has data.

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-08-04 09:10:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'd7e8f9a0b1c2'
down_revision: str | None = 'c6d7e8f9a0b1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_FK = 'fk_metric_nodes_saved_query_id'


def upgrade() -> None:
    op.add_column(
        'metric_nodes',
        sa.Column('source_kind', sa.String(length=8), nullable=False, server_default='manual'),
    )
    op.add_column('metric_nodes', sa.Column('saved_query_id', sa.String(length=36), nullable=True))
    op.add_column('metric_nodes', sa.Column('value_column', sa.String(length=255), nullable=True))
    op.add_column('metric_nodes', sa.Column('agg', sa.String(length=8), nullable=True))

    if op.get_bind().dialect.name == 'postgresql':
        op.create_foreign_key(
            _FK, 'metric_nodes', 'saved_queries', ['saved_query_id'], ['id'], ondelete='SET NULL'
        )
    # SQLite has no ALTER TABLE ADD CONSTRAINT; the only route is batch mode,
    # which rebuilds metric_nodes -- a table with a self-referential FK -- and
    # that is a bad trade here. The application database is Postgres in dev and
    # prod, and the unit suite builds its schema from the models rather than from
    # this file, so the gap is confined to a dev SQLite box upgraded through
    # migrations.
    #
    # Note the constraint is NOT inert on SQLite generally: db/session.py issues
    # PRAGMA foreign_keys=ON, so where the FK exists (any create_all schema) the
    # SET NULL genuinely fires. That is measured, not assumed -- deleting a bound
    # saved query in the test suite blanks metric_nodes.saved_query_id.
    #
    # Because SET NULL is therefore not guaranteed on EVERY path, the resolver
    # does not depend on it: resolve_leaf() treats both a blanked id and one
    # pointing at a missing row as `query_missing`.


def downgrade() -> None:
    if op.get_bind().dialect.name == 'postgresql':
        op.drop_constraint(_FK, 'metric_nodes', type_='foreignkey')
    op.drop_column('metric_nodes', 'agg')
    op.drop_column('metric_nodes', 'value_column')
    op.drop_column('metric_nodes', 'saved_query_id')
    op.drop_column('metric_nodes', 'source_kind')
