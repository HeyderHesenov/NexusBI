"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.config import settings
from app.core.exceptions import NexusBIException
from app.services.cache_service import build_cache_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.cache = await build_cache_service()
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

    @app.exception_handler(NexusBIException)
    async def _domain_error(request: Request, exc: NexusBIException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.__class__.__name__,
                "message": exc.message,
                "detail": exc.detail,
            },
        )

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, object]:
        return {"status": "ok", "demo_mode": settings.DEMO_MODE}

    app.include_router(api_router)
    return app


app = create_app()
