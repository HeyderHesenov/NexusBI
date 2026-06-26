"""Security hardening tests — SSRF guard, SQL guard, headers, authz, rate limit.

Driven by the OWASP API Security Top 10 checklist: BFLA (billing escalation,
covered in test_rate_limit), SSRF, injection guard, security misconfiguration
(headers, exposed metrics), and unrestricted resource consumption (rate limit).
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core import net_guard
from app.core.exceptions import DataSourceConnectionError, InvalidSQLError


# ─── SSRF guard (unit) ───
def test_ssrf_allows_sqlite_and_public():
    net_guard.assert_safe_connection_string("sqlite+aiosqlite:///./x.db")
    net_guard.assert_safe_connection_string("postgresql://u:p@8.8.8.8:5432/d")


@pytest.mark.parametrize(
    "conn",
    [
        "postgresql://u:p@169.254.169.254:5432/d",  # cloud metadata
        "postgresql://u:p@127.0.0.1:5432/d",  # loopback
        "postgresql://u:p@10.0.0.5:5432/d",  # private
        "mysql://u:p@192.168.1.10:3306/d",  # private
    ],
)
def test_ssrf_blocks_internal_hosts(conn):
    with pytest.raises(DataSourceConnectionError):
        net_guard.assert_safe_connection_string(conn)


async def test_ssrf_blocked_at_api(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/datasource/",
        json={
            "name": "evil",
            "db_type": "postgresql",
            "connection_string": "postgresql://u:p@169.254.169.254:5432/d",
        },
        headers=auth,
    )
    assert resp.status_code == 502, resp.text
    # Error responses must still carry the baseline security headers.
    assert resp.headers["X-Content-Type-Options"] == "nosniff"


# ─── SQL guard ───
def test_sql_guard_allows_select_and_cte():
    from app.ai.sql_guard import validate_select_only

    assert validate_select_only("SELECT 1 AS n")
    assert validate_select_only("WITH x AS (SELECT 1 AS n) SELECT * FROM x")


@pytest.mark.parametrize(
    "sql",
    [
        "PRAGMA table_info(users)",
        "SELECT 1; ATTACH DATABASE 'evil.db' AS e",
        "SELECT load_extension('evil.so')",
        "WITH x AS (SELECT 1) SELECT * FROM x; DETACH DATABASE e",
        "VACUUM",
        "DROP TABLE users",
    ],
)
def test_sql_guard_blocks_dangerous(sql):
    from app.ai.sql_guard import validate_select_only

    with pytest.raises(InvalidSQLError):
        validate_select_only(sql)


# ─── Security headers ───
async def test_security_headers_present(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "no-referrer"


# ─── Exposed metrics ───
async def test_metrics_blocked_for_non_loopback():
    # Simulate a remote scraper (non-loopback, no token) → 403. The default test
    # transport reports 127.0.0.1, which IS allowed, so override the client addr.
    from httpx import ASGITransport

    from app.main import app

    transport = ASGITransport(app=app, client=("203.0.113.9", 40000))
    async with AsyncClient(transport=transport, base_url="http://test") as remote:
        resp = await remote.get("/metrics")
    assert resp.status_code == 403


async def test_metrics_allowed_from_loopback(client: AsyncClient):
    # The default test client reports as loopback → scrape is allowed.
    resp = await client.get("/metrics")
    assert resp.status_code == 200


# ─── JWT tampering ───
async def test_forged_jwt_rejected(client: AsyncClient):
    from jose import jwt

    forged = jwt.encode({"sub": "someone"}, "attacker-key", algorithm="HS256")
    resp = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert resp.status_code == 401


# ─── Rate limiting (brute force) ───
async def test_login_rate_limited(client: AsyncClient):
    last = None
    for _ in range(12):
        last = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@nexusbi.io", "password": "wrong"},
        )
    assert last.status_code == 429, last.text
