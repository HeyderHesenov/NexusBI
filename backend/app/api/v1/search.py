"""Global semantic search — find dashboards / metrics / saved queries by meaning."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.ai import search
from app.core.rate_limit import rate_limit
from app.dependencies import CurrentUser, DbDep, RateLimitedUser
from app.schemas.search import ReindexResponse, SearchHitResponse

router = APIRouter(prefix="/search", tags=["search"])

# GET /search embeds the query (AI cost) but isn't AI-quota-metered — cap per-IP
# so a spammed search box can't drive unbounded embedding spend.
_search_limit = rate_limit("search", limit=60, window_seconds=60)


@router.get("", response_model=list[SearchHitResponse], dependencies=[Depends(_search_limit)])
async def search_assets(
    user: CurrentUser, db: DbDep, q: str = Query(min_length=1, max_length=200)
) -> list[SearchHitResponse]:
    hits = await search.search_assets(db, q, user.id)
    return [SearchHitResponse(kind=h.kind, ref_id=h.ref_id, title=h.title, score=h.score) for h in hits]


@router.post("/reindex", response_model=ReindexResponse)
async def reindex(user: RateLimitedUser, db: DbDep) -> ReindexResponse:
    """Rebuild the asset index (embeds new/changed assets). Consumes AI quota."""
    return ReindexResponse(indexed=await search.index_assets(db, user.id))
