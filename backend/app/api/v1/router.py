"""Aggregates all v1 routers."""
from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth, billing, dashboard, datasource, query, saved_query

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(datasource.router)
api_router.include_router(query.router)
api_router.include_router(dashboard.router)
api_router.include_router(billing.router)
api_router.include_router(saved_query.router)
