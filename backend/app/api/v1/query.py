"""Query endpoints — the NL → dashboard pipeline."""
from __future__ import annotations

from fastapi import APIRouter, Query, Response, status
from sqlalchemy import func, select

from app.ai import analysis, root_cause, stats_guard
from app.core.exceptions import AIGenerationError, NexusBIException, SchemaNotFoundError
from app.dependencies import CacheDep, CurrentUser, DbDep, RateLimitedUser
from app.models.query_log import QueryLog
from app.schemas.analysis import (
    AnomalyResponse,
    ExplainResponse,
    ForecastRequest,
    ForecastResponse,
    LineageResponse,
    RootCauseResponse,
    SignificanceResponse,
)
from app.schemas.query import (
    QueryHistoryItem,
    QueryHistoryPage,
    QueryRequest,
    QueryResult,
)
from app.schemas.scenario import (
    GoalSeekRequest,
    GoalSeekResponse,
    MonteCarloRequest,
    MonteCarloResponse,
)
from app.services import lineage_service, metric_service, query_service, scenario_service

router = APIRouter(prefix="/query", tags=["query"])


@router.post("/ask", response_model=QueryResult)
async def ask(
    payload: QueryRequest, user: RateLimitedUser, db: DbDep, cache: CacheDep
) -> QueryResult:
    return await query_service.process_nl_query(
        payload.nl_query,
        payload.datasource_id,
        user.id,
        db,
        cache,
        previous_query_log_id=payload.previous_query_log_id,
    )


@router.get("/history", response_model=QueryHistoryPage)
async def history(
    user: CurrentUser,
    db: DbDep,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> QueryHistoryPage:
    base = select(QueryLog).where(QueryLog.user_id == user.id)
    total = await db.scalar(
        select(func.count()).select_from(base.subquery())
    )
    result = await db.execute(
        base.order_by(QueryLog.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    items = [
        QueryHistoryItem(
            id=q.id,
            natural_language=q.natural_language,
            generated_sql=q.generated_sql,
            chart_type=q.chart_type,
            execution_time_ms=q.execution_time_ms,
            created_at=q.created_at.isoformat(),
        )
        for q in result.scalars().all()
    ]
    return QueryHistoryPage(items=items, page=page, limit=limit, total=total or 0)


@router.get("/{query_id}", response_model=QueryResult)
async def get_one(query_id: str, user: CurrentUser, db: DbDep) -> QueryResult:
    log = await _get_log(db, user.id, query_id)
    data = log.result_data or {"columns": [], "rows": []}
    from app.ai.types import ChartConfig
    from app.schemas.query import ColumnInfo

    return QueryResult(
        sql=log.generated_sql,
        data=data.get("rows", []),
        columns=[ColumnInfo(name=c) for c in data.get("columns", [])],
        chart_config=ChartConfig(**(log.chart_config or {"chart_type": log.chart_type})),
        insight=log.insight,
        execution_time_ms=log.execution_time_ms,
        query_log_id=log.id,
    )


@router.delete("/{query_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_one(query_id: str, user: CurrentUser, db: DbDep) -> Response:
    log = await _get_log(db, user.id, query_id)
    await db.delete(log)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{query_id}/retry", response_model=QueryResult)
async def retry(
    query_id: str, user: RateLimitedUser, db: DbDep, cache: CacheDep
) -> QueryResult:
    log = await _get_log(db, user.id, query_id)
    return await query_service.process_nl_query(
        log.natural_language, log.datasource_id, user.id, db, cache
    )


@router.post("/{query_id}/anomalies", response_model=AnomalyResponse)
async def anomalies(query_id: str, user: RateLimitedUser, db: DbDep) -> AnomalyResponse:
    log = await _get_log(db, user.id, query_id)
    data = log.result_data or {"columns": [], "rows": []}
    result = await analysis.detect_anomalies(
        data.get("columns", []), data.get("rows", []), log.natural_language
    )
    return AnomalyResponse(**result)


@router.post("/{query_id}/forecast", response_model=ForecastResponse)
async def forecast(
    query_id: str, payload: ForecastRequest, user: RateLimitedUser, db: DbDep
) -> ForecastResponse:
    log = await _get_log(db, user.id, query_id)
    data = log.result_data or {"columns": [], "rows": []}
    rows = data.get("rows", [])
    result = await analysis.forecast(
        data.get("columns", []), rows, log.natural_language, payload.periods
    )
    return ForecastResponse(**result, history=rows)


@router.post("/{query_id}/explain", response_model=ExplainResponse)
async def explain(query_id: str, user: RateLimitedUser, db: DbDep) -> ExplainResponse:
    log = await _get_log(db, user.id, query_id)
    data = log.result_data or {"columns": [], "rows": []}
    result = await analysis.explain(
        data.get("columns", []), data.get("rows", []), log.natural_language
    )
    return ExplainResponse(**result)


@router.post("/{query_id}/root-cause", response_model=RootCauseResponse)
async def root_cause_tree(query_id: str, user: RateLimitedUser, db: DbDep) -> RootCauseResponse:
    log = await _get_log(db, user.id, query_id)
    data = log.result_data or {"columns": [], "rows": []}
    result = await root_cause.decompose(
        data.get("columns", []), data.get("rows", []), log.natural_language
    )
    return RootCauseResponse(**result)


def _series(log: QueryLog) -> list[float]:
    data = log.result_data or {"columns": [], "rows": []}
    try:
        _label, value_col = analysis.pick_series(data.get("columns", []), data.get("rows", []))
    except AIGenerationError as exc:
        # No numeric column is a client-data precondition, not an upstream failure.
        raise NexusBIException(exc.message) from exc
    return [
        float(r[value_col])
        for r in data.get("rows", [])
        if isinstance(r.get(value_col), (int, float)) and not isinstance(r.get(value_col), bool)
    ]


@router.post("/{query_id}/goal-seek", response_model=GoalSeekResponse)
async def goal_seek(
    query_id: str, payload: GoalSeekRequest, user: CurrentUser, db: DbDep
) -> GoalSeekResponse:
    """How much change reaches the target from the latest value (no AI)."""
    log = await _get_log(db, user.id, query_id)
    return GoalSeekResponse(**scenario_service.goal_seek(_series(log), payload.target))


@router.post("/{query_id}/monte-carlo", response_model=MonteCarloResponse)
async def monte_carlo(
    query_id: str, payload: MonteCarloRequest, user: CurrentUser, db: DbDep
) -> MonteCarloResponse:
    """Monte Carlo projection (P10/P50/P90) from historical returns (no AI)."""
    log = await _get_log(db, user.id, query_id)
    try:
        result = scenario_service.monte_carlo(_series(log), payload.periods, payload.runs)
    except ValueError as exc:
        raise NexusBIException(str(exc)) from exc
    return MonteCarloResponse(**result)


@router.get("/{query_id}/lineage", response_model=LineageResponse)
async def lineage(query_id: str, user: CurrentUser, db: DbDep) -> LineageResponse:
    """Deterministic lineage: source tables/columns + metrics behind this result."""
    log = await _get_log(db, user.id, query_id)
    metrics = await metric_service.list_for(db, user.id, log.datasource_id)
    return LineageResponse(**lineage_service.lineage_for_query(log, metrics))


@router.post("/{query_id}/significance", response_model=SignificanceResponse)
async def significance(query_id: str, user: CurrentUser, db: DbDep) -> SignificanceResponse:
    """Statistical guard: trust checks on this result (sample size, real differences,
    spurious correlations). Pure math — no AI quota."""
    log = await _get_log(db, user.id, query_id)
    data = log.result_data or {"columns": [], "rows": []}
    return SignificanceResponse(**stats_guard.build_report(data.get("columns", []), data.get("rows", [])))


async def _get_log(db: DbDep, user_id: str, query_id: str) -> QueryLog:
    result = await db.execute(
        select(QueryLog).where(QueryLog.id == query_id, QueryLog.user_id == user_id)
    )
    log = result.scalar_one_or_none()
    if log is None:
        raise SchemaNotFoundError("Sorğu tapılmadı.")
    return log
