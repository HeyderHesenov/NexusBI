"""RAG retrieval: offline embedding determinism + user-scoped retrieval."""
from __future__ import annotations

from app.ai import client, retrieval
from app.config import settings
from app.db.session import AsyncSessionLocal
from app.models.user import User


async def _owner(db, user_id: str) -> str:
    """`query_embeddings.user_id` is a real FK, so an indexed row needs a real user.

    Spelled out here rather than reusing the registered test user: these tests are
    about scoping, so the ids have to be readable at the call site.
    """
    db.add(User(id=user_id, email=f"{user_id}@nexusbi.io", hashed_password="x"))
    await db.flush()
    return user_id


async def test_hash_embed_deterministic():
    # No AI_API_KEY in tests → deterministic offline hash embedding.
    a = await client.embed(["region üzrə gəlir"])
    b = await client.embed(["region üzrə gəlir"])
    assert a == b
    assert len(a[0]) == settings.RAG_HASH_DIM


async def test_retrieve_is_user_scoped():
    async with AsyncSessionLocal() as db:
        await _owner(db, "userA")  # "userB" only reads, so it needs no row
        await retrieval.index_text(
            db, user_id="userA", datasource_id=None, kind="query",
            text="region üzrə gəlir", sql="SELECT region, SUM(revenue) FROM sales GROUP BY region",
        )
        await db.commit()

        # Owner retrieves their example…
        own = await retrieval.retrieve_context(db, "region gəliri neçədir", "userA", None)
        assert "region üzrə gəlir" in own
        # …another user must never see it (RLS-safe).
        other = await retrieval.retrieve_context(db, "region gəliri neçədir", "userB", None)
        assert "SELECT" not in other


async def test_seed_demo_examples_idempotent():
    async with AsyncSessionLocal() as db:
        from sqlalchemy import func, select

        from app.models.query_embedding import QueryEmbedding

        first = await retrieval.seed_demo_examples(db)
        await retrieval.seed_demo_examples(db)  # second run must not duplicate
        await db.commit()
        cnt = (
            await db.execute(
                select(func.count()).select_from(QueryEmbedding).where(QueryEmbedding.user_id.is_(None))
            )
        ).scalar()
        assert first > 0
        assert cnt == first  # idempotent — dedup held


async def test_index_text_dedups():
    async with AsyncSessionLocal() as db:
        from sqlalchemy import func, select

        from app.models.query_embedding import QueryEmbedding

        await _owner(db, "dedup")
        for _ in range(3):
            await retrieval.index_text(
                db, user_id="dedup", datasource_id=None, kind="query", text="eyni sual", sql="SELECT 1",
            )
        await db.commit()
        cnt = (
            await db.execute(
                select(func.count()).select_from(QueryEmbedding).where(QueryEmbedding.user_id == "dedup")
            )
        ).scalar()
        assert cnt == 1
