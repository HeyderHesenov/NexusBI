"""Business knowledge graph endpoint (deterministic composition, no AI)."""
from __future__ import annotations

from fastapi import APIRouter

from app.dependencies import CurrentUser, DbDep
from app.schemas.graph import GraphResponse
from app.services import graph_service

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/", response_model=GraphResponse)
async def get_graph(user: CurrentUser, db: DbDep) -> GraphResponse:
    return GraphResponse.model_validate(await graph_service.build(db, user.id))
