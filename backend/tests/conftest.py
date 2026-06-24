"""Shared pytest fixtures: isolated test DB, app client, auth token."""
from __future__ import annotations

import os
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

# Force demo mode + a throwaway sqlite file before app import.
os.environ["DEMO_MODE"] = "true"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_nexusbi.db"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["FERNET_KEY"] = "PqQ8m3Vz3yQv8r9Xk2pYwLp1cQv4nF7sJ0aB6dE9gH0="

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
