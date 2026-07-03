"""Shared pytest fixtures: isolated test DB, app client, auth token."""
from __future__ import annotations

import os
import sqlite3
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Force demo mode + a throwaway sqlite file before app import.
os.environ["DEMO_MODE"] = "true"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_nexusbi.db"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["FERNET_KEY"] = "PqQ8m3Vz3yQv8r9Xk2pYwLp1cQv4nF7sJ0aB6dE9gH0="
# Hermetic tests: no real AI/network. Empties the key so embeddings use the
# deterministic offline fallback and Text2SQL uses rule-based — identical to CI.
os.environ["AI_API_KEY"] = ""
# Confine uploaded / test-seeded sqlite files to a throwaway temp dir instead of
# the working-tree default (./data/uploads), so runs don't accumulate .db files
# next to real uploads. Cleaned at process exit.
import atexit  # noqa: E402
import shutil  # noqa: E402
import tempfile  # noqa: E402

_UPLOAD_TMP = tempfile.mkdtemp(prefix="nexusbi_test_uploads_")
os.environ["UPLOAD_DIR"] = _UPLOAD_TMP
atexit.register(shutil.rmtree, _UPLOAD_TMP, ignore_errors=True)

from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import *  # noqa: E402,F401,F403

_engine = create_async_engine("sqlite+aiosqlite:///./test_nexusbi.db")
_Session = async_sessionmaker(_engine, expire_on_commit=False)


async def _override_get_db() -> AsyncGenerator:
    async with _Session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


app.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture(autouse=True)
async def _schema() -> AsyncGenerator[None, None]:
    # Reset the in-memory IP rate-limit store so counts don't bleed across tests.
    from app.core import rate_limit

    rate_limit._HITS.clear()
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def token(client: AsyncClient) -> str:
    resp = await client.post(
        "/api/v1/auth/register",
        json={"email": "test@nexusbi.io", "password": "pw1234", "full_name": "Tester"},
    )
    return resp.json()["access_token"]


@pytest_asyncio.fixture
def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def seed_sqlite_file(schema_sql: str = "CREATE TABLE t (x INTEGER)") -> str:
    """Create an on-disk SQLite DB inside UPLOAD_DIR → its async conn string.

    File-backed sqlite datasources are confined to UPLOAD_DIR (only the trusted
    upload/data-prep pipeline mints them, internal=True), so tests that need a
    real sqlite source must place theirs there too.
    """
    from app.config import settings

    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    db = upload_dir / f"test_src_{uuid.uuid4().hex}.db"
    con = sqlite3.connect(db)
    con.executescript(schema_sql)
    con.commit()
    con.close()
    return f"sqlite+aiosqlite:///{db.resolve()}"


async def seed_internal_datasource(
    email: str, name: str, conn_str: str
) -> str:
    """Seed a datasource via the trusted internal path (bypasses the public API,
    which blocks raw sqlite DSNs). Returns the new datasource id."""
    from app.models.user import User
    from app.services import datasource_service

    async with _Session() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one()
        ds = await datasource_service.add_datasource(
            db, user.id, name, "sqlite", conn_str, internal=True
        )
        await db.commit()
        return ds.id
