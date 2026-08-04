"""record when a query log's ROWS were fetched, not just when the row was written

`created_at` answers "when was this log row written", and the metric tree was
reading the run stamp beside it as if it answered "how old is this number". Two
production paths break that equivalence in opposite directions:

  cache hit          query_service._finalize persists a cached snapshot under a
                     FRESH log, so the rows can be CACHE_TTL_SECONDS older than
                     created_at claims (the tree OVERSTATES freshness)
  in-place refresh   dashboard_service.refresh_widget_data overwrites an existing
                     log's result_data without moving created_at, so the rows can
                     be newer (the number changes with no stamp movement at all)

Nullable with NO server_default on purpose. The application always sets it, so a
default would only ever paper over a missing write — and every one of the 55
differences the schema-drift ratchet accepts is a server_default mismatch, so not
declaring one keeps this column out of that baseline entirely.

Existing rows stay NULL and readers fall back to the run stamp, which is exactly
what they did before this column existed. Backfilling created_at was considered
and rejected: for every old row that was a cache hit it would MATERIALISE the
overstatement this column exists to remove, and turn a known-unknown into a
confident wrong answer.

Revision ID: e8f9a0b1c2d3
Revises: d7e8f9a0b1c2
Create Date: 2026-08-04 11:40:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'e8f9a0b1c2d3'
down_revision: str | None = 'd7e8f9a0b1c2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'query_logs',
        sa.Column('data_as_of', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('query_logs', 'data_as_of')
