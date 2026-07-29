"""A cluster-wide mutex around `alembic upgrade head`.

Two processes running migrations at the same moment is not a theoretical race.
`alembic_version` is a one-row table with no constraint that serialises writers,
so a concurrent pair can both read the same current revision, both decide the
same migration is pending, and both run it — producing a duplicate column, a
duplicate index, or a half-applied schema, depending on which statement loses.

The production compose already avoids this by running migrations in a one-shot
`migrate` service that must complete before the app starts. This lock is for
every other way a second migrator appears: a Kubernetes Job that retries while
the first attempt is still running, an operator running `alembic upgrade head`
by hand against a live deploy, or two hosts rolling out at once. In those cases
it is the only protection there is.

Deliberately NOT in the app lifespan: uvicorn runs N workers, so a lifespan
migration is N concurrent migrators by construction — the exact thing this
guards against, self-inflicted on every boot.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

# Any stable 64-bit constant works; advisory locks carry no meaning beyond the
# number. Fixed here (rather than hashed from a string at runtime) so the value
# cannot drift between versions and let an old and a new process both "hold" it.
MIGRATION_LOCK_KEY = 8_812_477_390_215_446_017

# Long enough for a real migration to finish, short enough that a wedged holder
# surfaces as a failed deploy instead of a container that hangs forever.
LOCK_TIMEOUT = "5min"


def lock_migrations(connection: Connection) -> None:
    """Block until this connection owns the migration lock. Postgres only.

    Uses the transaction-scoped variant, so the lock is released by the commit
    or rollback that ends the migration run — including the rollback that a
    failing migration triggers. There is no unlock path to forget.

    SQLite (tests, single-file dev installs) has no advisory locks and no
    concurrent writers to protect against, so this is a no-op there.
    """
    if connection.dialect.name != "postgresql":
        return
    connection.execute(text(f"SET LOCAL lock_timeout = '{LOCK_TIMEOUT}'"))
    connection.execute(
        text("SELECT pg_advisory_xact_lock(:key)"), {"key": MIGRATION_LOCK_KEY}
    )
