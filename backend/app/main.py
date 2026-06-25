"""FastAPI application entry point."""
from __future__ import annotations

import asyncio
import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.api.v1.router import api_router
from app.config import settings
from app.core import metrics
from app.core.exceptions import NexusBIException
from app.core.logging import configure_logging, get_logger
from app.services.cache_service import build_cache_service

configure_logging()
log = get_logger()


def _assert_production_secrets() -> None:
    """Fail fast if a non-demo deploy is missing real secrets."""
    if settings.DEMO_MODE:
        return
    if not settings.SECRET_KEY or settings.SECRET_KEY == "dev-insecure-change-me" or len(
        settings.SECRET_KEY
    ) < 32:
        raise RuntimeError("SECRET_KEY must be set to a strong value (>=32 chars) in production.")
    if not settings.FERNET_KEY:
        raise RuntimeError("FERNET_KEY must be set in production.")


async def _seed_demo_account() -> None:
    """Idempotently ensure an unlimited demo login exists (DEMO_MODE only)."""
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db.session import AsyncSessionLocal
    from app.models.user import User

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == "demo@nexusbi.io"))
        user = result.scalar_one_or_none()
        if user is None:
            db.add(
                User(
                    email="demo@nexusbi.io",
                    hashed_password=hash_password("demo1234"),
                    full_name="Demo",
                    subscription_tier="unlimited",
                )
            )
        elif user.subscription_tier != "unlimited":
            user.subscription_tier = "unlimited"
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _assert_production_secrets()
    app.state.cache = await build_cache_service()
    if settings.DEMO_MODE:
        try:
            await _seed_demo_account()
        except Exception as exc:  # noqa: BLE001 — never block startup on seeding
            log.warning("demo_seed_failed", error=str(exc))
    scheduler_task = None
    if settings.SCHEDULER_ENABLED:
        from app.services.scheduler import run_loop

        scheduler_task = asyncio.create_task(run_loop(app.state.cache))
    log.info("startup", demo_mode=settings.DEMO_MODE, cache=app.state.cache.available)
    yield
    if scheduler_task:
        scheduler_task.cancel()
    from app.db import engine_pool

    await engine_pool.dispose_all()


def create_app() -> FastAPI:
    app = FastAPI(
        title="NexusBI",
        description="Natural Language to Dashboard platform.",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        # Bearer-token auth (no cookies) — credentials not needed; scope methods/headers.
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
        finally:
            elapsed_s = time.perf_counter() - started
            # Use the route template (not the raw path) to keep label cardinality low.
            route = request.scope.get("route")
            route_label = getattr(route, "path", None) or "other"
            metrics.http_requests_total.labels(
                request.method, route_label, str(status_code)
            ).inc()
            metrics.http_request_duration_seconds.labels(
                request.method, route_label
            ).observe(elapsed_s)
            log.info(
                "request",
                method=request.method,
                path=request.url.path,
                execution_time_ms=int(elapsed_s * 1000),
            )
            structlog.contextvars.clear_contextvars()
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(NexusBIException)
    async def _domain_error(request: Request, exc: NexusBIException) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        log.warning("domain_error", error=exc.__class__.__name__, message=exc.message)
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.__class__.__name__,
                "message": exc.message,
                "detail": exc.detail,
                "sql": getattr(exc, "sql", None),
                "request_id": request_id,
            },
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        log.error("unhandled_error", error=type(exc).__name__, message=str(exc))
        return JSONResponse(
            status_code=500,
            content={
                "error": "InternalServerError",
                "message": "Daxili xəta baş verdi.",
                "detail": None,
                "request_id": request_id,
            },
        )

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, object]:
        return {"status": "ok", "demo_mode": settings.DEMO_MODE}

    @app.get("/metrics", tags=["health"])
    async def prometheus_metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(api_router)
    return app


app = create_app()
