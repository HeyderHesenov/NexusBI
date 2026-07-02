"""Dashboard time-machine endpoints (snapshot capture / list / read / delete)."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CurrentUser, DbDep
from app.schemas.snapshot import SnapshotCreate, SnapshotMeta, SnapshotResponse, SnapshotWidget
from app.services import snapshot_service as svc

router = APIRouter(prefix="/dashboard", tags=["snapshots"])


def _to_response(snap) -> SnapshotResponse:
    return SnapshotResponse(
        id=snap.id,
        label=snap.label,
        origin=snap.origin,
        created_at=snap.created_at,
        widgets=[SnapshotWidget(**w) for w in snap.payload.get("widgets", [])],
    )


@router.post(
    "/{dashboard_id}/snapshots",
    response_model=SnapshotMeta,
    status_code=status.HTTP_201_CREATED,
)
async def capture(
    dashboard_id: str, payload: SnapshotCreate, user: CurrentUser, db: DbDep
) -> SnapshotMeta:
    snap = await svc.capture(db, user.id, dashboard_id, label=payload.label)
    return SnapshotMeta.model_validate(snap)


@router.get("/{dashboard_id}/snapshots", response_model=list[SnapshotMeta])
async def list_snapshots(
    dashboard_id: str, user: CurrentUser, db: DbDep
) -> list[SnapshotMeta]:
    return [
        SnapshotMeta(**meta) for meta in await svc.list_meta(db, user.id, dashboard_id)
    ]


@router.get("/{dashboard_id}/snapshots/{snapshot_id}", response_model=SnapshotResponse)
async def get_snapshot(
    dashboard_id: str, snapshot_id: str, user: CurrentUser, db: DbDep
) -> SnapshotResponse:
    return _to_response(await svc.get(db, user.id, dashboard_id, snapshot_id))


@router.delete("/{dashboard_id}/snapshots/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_snapshot(
    dashboard_id: str, snapshot_id: str, user: CurrentUser, db: DbDep
) -> Response:
    await svc.remove(db, user.id, dashboard_id, snapshot_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
