"""Aggregates all v1 routers."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    ai_quality, alert, auth, billing, branding, copilot, dashboard, dataprep, datasource,
    decision, experiment, insight, integration, metric, public, query, requirement,
    saved_query, scenario, workspace,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(datasource.router)
api_router.include_router(dataprep.router)
api_router.include_router(query.router)
api_router.include_router(dashboard.router)
api_router.include_router(billing.router)
api_router.include_router(branding.router)
api_router.include_router(saved_query.router)
api_router.include_router(metric.router)
api_router.include_router(alert.router)
api_router.include_router(decision.router)
api_router.include_router(experiment.router)
api_router.include_router(insight.router)
api_router.include_router(integration.router)
api_router.include_router(copilot.router)
api_router.include_router(requirement.router)
api_router.include_router(scenario.router)
api_router.include_router(workspace.router)
api_router.include_router(ai_quality.router)
api_router.include_router(public.router)
