"""Liveness and readiness probes.

Two different questions, and collapsing them is how a deployment ends up lying
about itself:

- **Liveness** — is this process running? A failure means "restart the
  container", so it must not consult the database: during a database outage a
  liveness-gated pod would restart-loop while having nothing wrong with it.
- **Readiness** — can this process serve traffic? A failure means "stop routing
  here". An app that booted against an unreachable or unmigrated database is
  exactly that case, and it is the one the old single ``/health`` got wrong by
  answering ``ok`` regardless.

Probes are bounded by ``_PROBE_TIMEOUT_SECONDS``: a readiness check that hangs
is a readiness check that fails, because the load balancer is waiting on it.
"""
from __future__ import annotations

import asyncio
from functools import lru_cache
from pathlib import Path

from sqlalchemy import text

from app.core.logging import get_logger
from app.services.cache_service import CacheService

log = get_logger("nexusbi.health")

_PROBE_TIMEOUT_SECONDS = 2.0


@lru_cache(maxsize=1)
def _migration_heads() -> frozenset[str]:
    """Revision ids the code expects the database to be at.

    Read from the migration scripts rather than a constant, so the expectation
    cannot drift from what is actually in the repo. Cached because the files do
    not change while the process runs.
    """
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config()
    cfg.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "db" / "migrations")
    )
    return frozenset(ScriptDirectory.from_config(cfg).get_heads())


async def _database_status() -> tuple[str, str]:
    """Return ``(database, migrations)`` statuses from a single connection."""
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await db.execute(text("SELECT 1"))
        try:
            rows = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalars()
            applied = set(rows.all())
        except Exception:
            # No alembic_version table at all: the schema was never migrated.
            return "ok", "error: no migration history"

    expected = _migration_heads()
    if not applied:
        return "ok", "error: no migration history"
    if not applied <= expected:
        behind = ", ".join(sorted(applied - expected))
        return "ok", f"error: database at {behind}, expected {', '.join(sorted(expected))}"
    return "ok", "ok"


async def _cache_status(cache: CacheService | None) -> str:
    if cache is None or not cache.available:
        return "unavailable"
    try:
        return "ok" if await cache.ping() else "unavailable"
    except Exception:
        return "unavailable"


async def readiness(cache: CacheService | None) -> tuple[bool, dict[str, str]]:
    """Return ``(ready, per-component status)``.

    Only the database and its migration state gate readiness. Redis is reported
    but not gating: the app is built to degrade without it (every cache call
    no-ops), so refusing traffic would be a lie in the other direction. That
    changes when Redis becomes load-bearing — scheduler leader election — and
    this is where the check moves when it does.
    """
    components: dict[str, str] = {}
    try:
        database, migrations = await asyncio.wait_for(
            _database_status(), timeout=_PROBE_TIMEOUT_SECONDS
        )
    except TimeoutError:
        database, migrations = f"error: timeout after {_PROBE_TIMEOUT_SECONDS}s", "unknown"
    except Exception as exc:
        database, migrations = f"error: {str(exc)[:200]}", "unknown"
    components["database"] = database
    components["migrations"] = migrations
    components["cache"] = await _cache_status(cache)

    ready = database == "ok" and migrations == "ok"
    if not ready:
        log.warning("not_ready", **components)
    return ready, components
