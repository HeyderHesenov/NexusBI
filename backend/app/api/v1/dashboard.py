"""Dashboard endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CacheDep, CurrentUser, DbDep
from app.schemas.dashboard import (
    DashboardCreate,
    DashboardResponse,
    DashboardSummary,
    DashboardUpdate,
    WidgetCreate,
    WidgetResponse,
)
from app.services import dashboard_service as svc

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.post("/", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: DashboardCreate, user: CurrentUser, db: DbDep) -> DashboardResponse:
    dash = await svc.create_dashboard(db, user.id, payload.name, payload.description)
    return DashboardResponse(
        id=dash.id, name=dash.name, description=dash.description, layout=dash.layout, widgets=[]
    )


@router.get("/", response_model=list[DashboardSummary])
async def list_all(user: CurrentUser, db: DbDep) -> list[DashboardSummary]:
    items = await svc.list_dashboards(db, user.id)
    return [DashboardSummary.model_validate(d) for d in items]


async def _dashboard_response(db: DbDep, user_id: str, dash) -> DashboardResponse:
    return DashboardResponse(
        id=dash.id,
        name=dash.name,
        description=dash.description,
        layout=dash.layout,
        widgets=await svc.widgets_to_response(db, list(dash.widgets), user_id),
    )


@router.get("/{dashboard_id}", response_model=DashboardResponse)
async def get_one(dashboard_id: str, user: CurrentUser, db: DbDep) -> DashboardResponse:
    dash = await svc.get_dashboard(db, user.id, dashboard_id)
    return await _dashboard_response(db, user.id, dash)


@router.put("/{dashboard_id}", response_model=DashboardResponse)
async def update(
    dashboard_id: str, payload: DashboardUpdate, user: CurrentUser, db: DbDep
) -> DashboardResponse:
    dash = await svc.update_dashboard(
        db, user.id, dashboard_id, payload.model_dump(exclude_unset=True)
    )
    return await _dashboard_response(db, user.id, dash)


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(dashboard_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete_dashboard(db, user.id, dashboard_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{dashboard_id}/widget", response_model=WidgetResponse, status_code=status.HTTP_201_CREATED)
async def add_widget(
    dashboard_id: str, payload: WidgetCreate, user: CurrentUser, db: DbDep
) -> WidgetResponse:
    widget = await svc.add_widget(db, user.id, dashboard_id, payload.model_dump())
    responses = await svc.widgets_to_response(db, [widget], user.id)
    return responses[0]


@router.post("/{dashboard_id}/widget/{widget_id}/refresh", response_model=WidgetResponse)
async def refresh_widget(
    dashboard_id: str, widget_id: str, user: CurrentUser, db: DbDep, cache: CacheDep
) -> WidgetResponse:
    widget = await svc.refresh_widget(db, cache, user.id, dashboard_id, widget_id)
    responses = await svc.widgets_to_response(db, [widget], user.id)
    return responses[0]


@router.post("/{dashboard_id}/refresh-all", response_model=DashboardResponse)
async def refresh_all(
    dashboard_id: str, user: CurrentUser, db: DbDep, cache: CacheDep
) -> DashboardResponse:
    dash = await svc.refresh_all_widgets(db, cache, user.id, dashboard_id)
    return await _dashboard_response(db, user.id, dash)


@router.delete("/{dashboard_id}/widget/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_widget(
    dashboard_id: str, widget_id: str, user: CurrentUser, db: DbDep
) -> Response:
    await svc.delete_widget(db, user.id, dashboard_id, widget_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
