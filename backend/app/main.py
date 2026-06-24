"""FastAPI application entry point."""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.config import settings
from app.core.exceptions import NexusBIException
from app.core.logging import configure_logging, get_logger
from app.services.cache_service import build_cache_service

configure_logging()
log = get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.cache = await build_cache_service()
    log.info("startup", demo_mode=settings.DEMO_MODE, cache=app.state.cache.available)
    yield


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
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            elapsed = int((time.perf_counter() - started) * 1000)
            log.info(
                "request",
                method=request.method,
                path=request.url.path,
                execution_time_ms=elapsed,
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

    app.include_router(api_router)
    return app


app = create_app()
