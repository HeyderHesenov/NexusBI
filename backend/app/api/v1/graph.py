"""Business knowledge graph endpoint (deterministic composition, no AI).

``GET /graph/`` composes the read-only graph. ``/graph/views`` is a small CRUD for
saved, user-curated views (filters) applied client-side over that single payload —
they never mutate real assets.
"""
from __future__ import annotations

from fastapi import APIRouter, Query, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.graph import (
    GraphResponse,
    GraphViewCreate,
    GraphViewResponse,
    GraphViewUpdate,
)
from app.services import audit_service, graph_service, graph_view_service

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("/", response_model=GraphResponse)
async def get_graph(
    user: CurrentUser,
    db: DbDep,
    columns: bool = Query(default=False, description="Expand table columns as nodes"),
) -> GraphResponse:
    graph = await graph_service.build(db, user.id, include_columns=columns)
    return GraphResponse.model_validate(graph)


# --- Saved views -------------------------------------------------------------


@router.get("/views", response_model=list[GraphViewResponse])
async def list_views(user: CurrentUser, db: DbDep) -> list[GraphViewResponse]:
    views = await graph_view_service.list_views(db, user.id)
    return [GraphViewResponse.model_validate(v) for v in views]


@router.post("/views", response_model=GraphViewResponse, status_code=status.HTTP_201_CREATED)
async def create_view(
    payload: GraphViewCreate, user: CurrentUser, db: DbDep
) -> GraphViewResponse:
    view = await graph_view_service.create_view(
        db,
        user.id,
        name=payload.name.strip(),
        included_node_ids=payload.included_node_ids,
        hidden_node_ids=payload.hidden_node_ids,
        hidden_edge_keys=payload.hidden_edge_keys,
    )
    await audit_service.log(
        db, user.id, "graph_view.create", entity="graph_view", entity_id=view.id
    )
    return GraphViewResponse.model_validate(view)


@router.patch("/views/{view_id}", response_model=GraphViewResponse)
async def update_view(
    view_id: str, payload: GraphViewUpdate, user: CurrentUser, db: DbDep
) -> GraphViewResponse:
    view = await graph_view_service.update_view(
        db, user.id, view_id, payload.model_dump(exclude_unset=True)
    )
    return GraphViewResponse.model_validate(view)


@router.delete("/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_view(view_id: str, user: CurrentUser, db: DbDep) -> Response:
    await graph_view_service.delete_view(db, user.id, view_id)
    await audit_service.log(
        db, user.id, "graph_view.delete", entity="graph_view", entity_id=view_id
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
