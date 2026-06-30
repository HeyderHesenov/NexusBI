"""Data contract endpoints."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.dependencies import CacheDep, CurrentUser, DbDep
from app.schemas.data_contract import (
    ContractRunResponse,
    DataContractCreate,
    DataContractResponse,
)
from app.services import data_contract_service as svc

router = APIRouter(prefix="/contracts", tags=["contracts"])


@router.post("/", response_model=DataContractResponse, status_code=status.HTTP_201_CREATED)
async def create(payload: DataContractCreate, user: CurrentUser, db: DbDep) -> DataContractResponse:
    return DataContractResponse.model_validate(await svc.create(db, user.id, payload))


@router.get("/", response_model=list[DataContractResponse])
async def list_contracts(user: CurrentUser, db: DbDep) -> list[DataContractResponse]:
    return [DataContractResponse.model_validate(c) for c in await svc.list_for(db, user.id)]


@router.post("/{contract_id}/run", response_model=DataContractResponse)
async def run(contract_id: str, user: CurrentUser, db: DbDep, cache: CacheDep) -> DataContractResponse:
    return DataContractResponse.model_validate(await svc.run(db, cache, user.id, contract_id))


@router.get("/{contract_id}/runs", response_model=list[ContractRunResponse])
async def runs(contract_id: str, user: CurrentUser, db: DbDep) -> list[ContractRunResponse]:
    return [ContractRunResponse.model_validate(r) for r in await svc.runs_for(db, user.id, contract_id)]


@router.delete("/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(contract_id: str, user: CurrentUser, db: DbDep) -> Response:
    await svc.delete(db, user.id, contract_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
