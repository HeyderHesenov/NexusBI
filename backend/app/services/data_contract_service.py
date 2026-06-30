"""Data contracts — schema/quality guarantees on a datasource table.

A fully new subsystem (no data-quality concept existed). It REUSES the existing
profiling primitives (`profiling_service.profile` → per-column null%/distinct/min/max
on a safe, validated sample) for column checks, `get_schema_cached` for schema-drift
detection, and the datasource freshness fields — so no raw SQL is built here.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.notification_types import NotificationCategory
from app.models.alert import Notification
from app.models.data_contract import ContractRun, DataContract
from app.services import datasource_service, profiling_service
from app.services.cache_service import CacheService
from app.core.exceptions import SchemaNotFoundError

# Column-level rules evaluated against profile stats; freshness/schema are contract-level.
_COLUMN_RULES = {"not_null", "unique", "min", "max", "range"}


async def create(db: AsyncSession, user_id: str, payload) -> DataContract:
    await datasource_service.get_datasource(db, user_id, payload.datasource_id)  # ownership
    c = DataContract(
        user_id=user_id, datasource_id=payload.datasource_id, table_name=payload.table_name,
        name=payload.name, expectations=[e.model_dump() for e in payload.expectations],
    )
    db.add(c)
    await db.flush()
    await db.refresh(c)
    return c


async def list_for(db: AsyncSession, user_id: str) -> list[DataContract]:
    res = await db.execute(
        select(DataContract).where(DataContract.user_id == user_id).order_by(DataContract.created_at.desc())
    )
    return list(res.scalars().all())


async def get(db: AsyncSession, user_id: str, contract_id: str) -> DataContract:
    res = await db.execute(
        select(DataContract).where(DataContract.id == contract_id, DataContract.user_id == user_id)
    )
    c = res.scalar_one_or_none()
    if c is None:
        raise SchemaNotFoundError("Müqavilə tapılmadı.")
    return c


async def delete(db: AsyncSession, user_id: str, contract_id: str) -> None:
    await get(db, user_id, contract_id)  # ownership
    # SQLite doesn't enforce ON DELETE CASCADE without PRAGMA, so remove run history
    # explicitly to avoid orphaned contract_runs rows.
    await db.execute(sql_delete(ContractRun).where(ContractRun.contract_id == contract_id))
    await db.execute(
        sql_delete(DataContract).where(DataContract.id == contract_id, DataContract.user_id == user_id)
    )
    await db.flush()


def _check_column(exp: dict, stat: dict | None) -> dict:
    rule, col, params = exp.get("rule"), exp.get("column"), exp.get("params") or {}
    base = {"column": col, "rule": rule}
    if stat is None:
        return {**base, "passed": False, "detail": f"'{col}' sütunu tapılmadı."}
    if rule == "not_null":
        ok = stat["null_pct"] == 0
        return {**base, "passed": ok, "detail": f"null {stat['null_pct']}%"}
    if rule == "unique":
        ok = stat["distinct"] == stat["sample_size"]
        return {**base, "passed": ok, "detail": f"{stat['distinct']}/{stat['sample_size']} fərqli (nümunə)"}
    if rule in ("min", "max", "range"):
        lo, hi = params.get("min"), params.get("max")
        smin, smax = stat["min"], stat["max"]
        if smin is None or smax is None:
            return {**base, "passed": False, "detail": "ədədi deyil"}
        ok = (lo is None or smin >= lo) and (hi is None or smax <= hi)
        return {**base, "passed": ok, "detail": f"diapazon [{smin:g}, {smax:g}]"}
    return {**base, "passed": False, "detail": "dəstəklənməyən qayda"}


async def run(db: AsyncSession, cache: CacheService, user_id: str, contract_id: str) -> DataContract:
    contract = await get(db, user_id, contract_id)
    ds = await datasource_service.get_datasource(db, user_id, contract.datasource_id)
    results: list[dict] = []

    # Column checks via the safe, validated profiling sample.
    profile = await profiling_service.profile(db, user_id, contract.datasource_id, contract.table_name, cache)
    stats = {c["column"]: c for c in profile["columns"]}
    for exp in contract.expectations:
        rule = exp.get("rule")
        if rule in _COLUMN_RULES:
            results.append(_check_column(exp, stats.get(exp.get("column"))))
        elif rule == "schema":
            schema = await datasource_service.get_schema_cached(ds, cache)
            digest = hashlib.sha256(json.dumps(schema, sort_keys=True, default=str).encode()).hexdigest()
            if contract.schema_hash is None:
                contract.schema_hash = digest
                results.append({"column": None, "rule": "schema", "passed": True, "detail": "ilk sxem qeydə alındı"})
            else:
                ok = digest == contract.schema_hash
                results.append({"column": None, "rule": "schema", "passed": ok,
                                "detail": "sxem dəyişməyib" if ok else "sxem dəyişib (drift)"})
        elif rule == "freshness":
            sla = ds.freshness_sla_hours
            last = ds.last_refreshed_at
            if not sla or last is None:
                results.append({"column": None, "rule": "freshness", "passed": True, "detail": "SLA təyin edilməyib"})
            else:
                age_h = (datetime.now(timezone.utc) - last).total_seconds() / 3600
                ok = age_h <= sla
                results.append({"column": None, "rule": "freshness", "passed": ok,
                                "detail": f"{age_h:.1f}s yaş (SLA {sla}s)"})
        else:
            # Fail-CLOSED: an unrecognized rule must never silently pass a quality gate.
            results.append({"column": exp.get("column"), "rule": rule, "passed": False,
                            "detail": "dəstəklənməyən qayda"})

    # No expectations → nothing verified; "unknown", not a green "pass".
    if not results:
        status = "unknown"
    else:
        status = "pass" if all(r["passed"] for r in results) else "fail"
    contract.last_status = status
    contract.last_run_at = datetime.now(timezone.utc)
    db.add(ContractRun(contract_id=contract.id, status=status, results=results))

    if status == "fail":
        failed = [r["rule"] for r in results if not r["passed"]]
        db.add(Notification(
            user_id=user_id, category=NotificationCategory.KPI_ALERT,
            title=f"Data müqaviləsi pozuldu: {contract.name}",
            body=f"«{contract.table_name}» — uğursuz: {', '.join(failed)}.",
        ))
    await db.flush()
    await db.refresh(contract)
    return contract


async def runs_for(db: AsyncSession, user_id: str, contract_id: str, limit: int = 10) -> list[ContractRun]:
    await get(db, user_id, contract_id)  # ownership
    res = await db.execute(
        select(ContractRun).where(ContractRun.contract_id == contract_id)
        .order_by(ContractRun.created_at.desc()).limit(limit)
    )
    return list(res.scalars().all())
