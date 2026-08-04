"""record how old a decision measurement's data was, beside where it sits on the timeline

`decision_measurements.measured_at` is doing one job that looked like two. It is
the point's position on the decision timeline — counterfactual() splits the
pre/post history on `measured_at < baseline_at` — and it was ALSO being read as
"when this number was true". Those diverge whenever a measurement is not a live
run:

  baseline from a stored log   _capture_baseline reuses the spawning query's
                               persisted result with no re-run, so the number can
                               be hours old while the decision is being made now
  baseline from the cache      its fallback calls process_nl_query WITHOUT
                               bypass_cache, so a hit serves rows up to
                               CACHE_TTL_SECONDS old under a fresh log
  scheduled re-measure         _measure genuinely re-executes, so there the two
                               legitimately agree

Repointing `measured_at` at the data's age was considered and rejected: it would
move a baseline taken from an older query BACKWARDS past `baseline_at`, drop it
into the pre-decision bucket, and silently change which counterfactual method
runs — a scoring change disguised as a timestamp fix.

Nullable with NO server_default, for the same reasons as query_logs.data_as_of:
the application always sets it, and every difference the schema-drift ratchet
accepts is a server_default mismatch, so declaring none keeps this column out of
that baseline.

Existing rows stay NULL, meaning "unknown". Backfilling `measured_at` was
rejected — it would assert the exact equality this column exists to stop
assuming, turning a known-unknown into a confident wrong answer.

NULL is NOT a marker for "written before this migration": a live write lands
there too whenever the source log predates `query_logs.data_as_of`, or was
served from a cache entry already in flight when that stamp shipped. The column
answers "do we know?" first and "how old?" second.

Revision ID: f9a0b1c2d3e4
Revises: e8f9a0b1c2d3
Create Date: 2026-08-04 15:30:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = 'f9a0b1c2d3e4'
down_revision: str | None = 'e8f9a0b1c2d3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'decision_measurements',
        sa.Column('data_as_of', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('decision_measurements', 'data_as_of')
