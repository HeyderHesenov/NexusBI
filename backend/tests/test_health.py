"""Liveness and readiness probes.

The distinction is the point: /live must stay up while dependencies are broken
(a restart would not help), and /ready must go down in exactly that case (a load
balancer must stop sending traffic). The old single /health returned `ok` with a
dead database, which is the worst of both.
"""
from __future__ import annotations

from httpx import AsyncClient


async def test_live_is_static(client: AsyncClient):
    resp = await client.get("/live")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_live_stays_up_when_dependencies_are_down(client: AsyncClient, monkeypatch):
    """Liveness must not depend on the database, or an outage restart-loops pods."""
    from app.core import health

    async def dead(*a, **kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(health, "_database_status", dead)
    assert (await client.get("/live")).status_code == 200


async def test_ready_ok_on_a_healthy_stack(client: AsyncClient):
    resp = await client.get("/ready")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "ready"
    assert body["components"]["database"] == "ok"
    assert body["components"]["migrations"] == "ok"


async def test_ready_503_when_database_is_unreachable(client: AsyncClient, monkeypatch):
    from app.core import health

    async def dead(*a, **kw):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(health, "_database_status", dead)
    resp = await client.get("/ready")
    assert resp.status_code == 503, resp.text
    assert resp.json()["components"]["database"].startswith("error")


async def test_ready_503_when_migrations_are_behind(client: AsyncClient):
    """A booted app on an unmigrated database serves errors, so it is not ready.

    This is the failure mode that made the old /health misleading: the container
    starts, answers `ok`, and every request that touches a missing column 500s.
    """
    from sqlalchemy import text

    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await db.execute(text("UPDATE alembic_version SET version_num = 'not_the_head'"))
        await db.commit()

    resp = await client.get("/ready")
    assert resp.status_code == 503, resp.text
    assert "not_the_head" in resp.json()["components"]["migrations"]


async def test_ready_tolerates_a_missing_cache(client: AsyncClient):
    """Redis is still optional — the app degrades rather than failing.

    Reported so an operator can see it, but not gating: promoting it belongs with
    the change that makes Redis load-bearing (scheduler leader election).
    """
    resp = await client.get("/ready")
    assert resp.status_code == 200, resp.text
    assert resp.json()["components"]["cache"] == "unavailable"


async def test_ready_reports_a_reachable_cache(client: AsyncClient, monkeypatch):
    from app.core import health

    class _Reachable:
        available = True

        async def ping(self) -> bool:
            return True

    monkeypatch.setattr(client._transport.app.state, "cache", _Reachable(), raising=False)
    resp = await client.get("/ready")
    assert resp.status_code == 200, resp.text
    assert resp.json()["components"]["cache"] == "ok"
    assert await health._cache_status(None) == "unavailable"


async def test_health_still_answers_for_existing_probes(client: AsyncClient):
    """CI's smoke and any deployed HEALTHCHECK still curl /health."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_ready_reports_ai_degraded_without_a_key(client: AsyncClient):
    """The suite runs keyless (conftest empties AI_API_KEY), like a keyless deploy."""
    resp = await client.get("/ready")
    assert resp.status_code == 200, resp.text
    assert resp.json()["components"]["ai"].startswith("degraded")


async def test_ready_reports_ai_ok_when_configured(client: AsyncClient, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "AI_API_KEY", "sk-test", raising=False)
    monkeypatch.setattr(settings, "AI_MODEL", "gpt-4o-mini", raising=False)
    resp = await client.get("/ready")
    assert resp.status_code == 200, resp.text
    assert resp.json()["components"]["ai"] == "ok"


def test_production_boots_without_an_ai_key(monkeypatch):
    """A keyless self-hosted install is supported, not a boot failure.

    Every AI feature falls back to a deterministic path, so refusing to start
    would lock operators out of the product over an optional dependency.
    """
    from app.config import settings
    from app.main import _assert_production_secrets

    monkeypatch.setattr(settings, "DEMO_MODE", False, raising=False)
    monkeypatch.setattr(settings, "AI_API_KEY", "", raising=False)
    _assert_production_secrets()  # must not raise


def test_production_still_refuses_weak_signing_secrets(monkeypatch):
    """The fatal checks stay fatal — this is the half that must not be relaxed."""
    import os

    import pytest

    from app.config import settings
    from app.main import _assert_production_secrets

    monkeypatch.setattr(settings, "DEMO_MODE", False, raising=False)
    monkeypatch.setattr(settings, "SECRET_KEY", "too-short", raising=False)
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        _assert_production_secrets()

    # conftest already exports a long-enough key; reusing it beats writing a
    # second credential-shaped literal into the repository for the scanner to
    # find, and keeps the two in step if either changes.
    monkeypatch.setattr(settings, "SECRET_KEY", os.environ["SECRET_KEY"], raising=False)
    monkeypatch.setattr(settings, "FERNET_KEY", "", raising=False)
    with pytest.raises(RuntimeError, match="FERNET_KEY"):
        _assert_production_secrets()
