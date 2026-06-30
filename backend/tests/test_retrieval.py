"""RAG retrieval: offline embedding determinism + user-scoped retrieval."""
from __future__ import annotations

from app.ai import client, retrieval
from app.config import settings
from app.db.session import AsyncSessionLocal


async def test_hash_embed_deterministic():
    # No OPENAI_API_KEY in tests → deterministic offline hash embedding.
    a = await client.embed(["region üzrə gəlir"])
    b = await client.embed(["region üzrə gəlir"])
    assert a == b
    assert len(a[0]) == settings.RAG_HASH_DIM


async def test_retrieve_is_user_scoped():
    async with AsyncSessionLocal() as db:
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


async def test_index_text_dedups():
    async with AsyncSessionLocal() as db:
        from sqlalchemy import func, select

        from app.models.query_embedding import QueryEmbedding

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
