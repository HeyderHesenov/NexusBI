"""FastAPI application entry point."""
from __future__ import annotations

import asyncio
import time
import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.api.v1.router import api_router
from app.config import settings
from app.core import metrics
from app.core import i18n
from app.core.exceptions import NexusBIException
from app.core.logging import configure_logging, get_logger
from app.services.cache_service import build_cache_service

configure_logging()
log = get_logger()


def _apply_security_headers(response) -> None:
    """Baseline security headers — applied to normal AND error responses."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    # API responses are never embedded; restrict framing at the CSP layer too
    # (complements X-Frame-Options without restricting the Swagger /docs assets).
    response.headers["Content-Security-Policy"] = "frame-ancestors 'none'"
    if not settings.DEMO_MODE:
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"


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
    if not settings.AI_API_KEY:
        raise RuntimeError("AI_API_KEY must be set in production.")


def _harden_demo_secrets() -> None:
    """In demo, never fall back to a predictable signing key.

    If SECRET_KEY is unset, mint a random ephemeral one (tokens become invalid on
    restart — acceptable for demo, far safer than a committed constant). Warn when
    FERNET_KEY is missing since datasource connection strings would then be
    unencryptable.
    """
    import secrets as _secrets

    if not settings.DEMO_MODE:
        return
    if not settings.SECRET_KEY or settings.SECRET_KEY == "dev-insecure-change-me":
        settings.SECRET_KEY = _secrets.token_urlsafe(48)
        log.warning("ephemeral_secret_key", msg="SECRET_KEY boşdur — efemer açar yaradıldı.")
    if not settings.FERNET_KEY:
        log.warning(
            "fernet_key_missing",
            msg="FERNET_KEY boşdur — datasource bağlantıları şifrələnə bilməz.",
        )


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


async def _seed_rag_examples() -> None:
    """Seed global demo Q→SQL exemplars into the RAG store (DEMO_MODE only, idempotent)."""
    if not settings.RAG_ENABLED:
        return
    from app.ai import retrieval
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await retrieval.seed_demo_examples(db)
        await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _assert_production_secrets()
    _harden_demo_secrets()
    if not settings.AI_API_KEY:
        # Demo mode still works via the rule-based SQL fallback, but warn loudly
        # so a misconfigured key is obvious in the logs instead of silent 401s.
        log.warning(
            "ai_key_missing",
            msg="AI mühərriki açarı boşdur — demo qayda-əsaslı fallback ilə işləyəcək.",
        )
    app.state.cache = await build_cache_service()
    if settings.DEMO_MODE:
        try:
            await _seed_demo_account()
            await _seed_rag_examples()
        except Exception as exc:  # noqa: BLE001 — never block startup on seeding
            log.warning("demo_seed_failed", error=str(exc))
    # The chat assistant user exists in EVERY mode (paid tiers use it outside
    # demo). Lazy get-or-create covers tests, which skip this lifespan entirely.
    try:
        from app.db.session import AsyncSessionLocal
        from app.services import ai_chat_service

        async with AsyncSessionLocal() as db:
            await ai_chat_service.get_or_create_assistant(db)
            await db.commit()
    except Exception as exc:  # noqa: BLE001 — never block startup on seeding
        log.warning("assistant_seed_failed", error=str(exc))
    background_tasks: list[asyncio.Task] = []
    if settings.SCHEDULER_ENABLED:
        from app.services.scheduler import run_loop

        background_tasks.append(asyncio.create_task(run_loop(app.state.cache)))
    if settings.LIVE_REFRESH_ENABLED:
        from app.realtime.live_refresh import run_loop as live_run_loop

        background_tasks.append(asyncio.create_task(live_run_loop()))
    log.info("startup", demo_mode=settings.DEMO_MODE, cache=app.state.cache.available)
    yield
    for task in background_tasks:
        task.cancel()
    from app.db import engine_pool

    await engine_pool.dispose_all()


def create_app() -> FastAPI:
    # Interactive API docs reveal the full schema; expose them in demo only.
    _docs = "/docs" if settings.DEMO_MODE else None
    _redoc = "/redoc" if settings.DEMO_MODE else None
    app = FastAPI(
        title="NexusBI",
        description="Natural Language to Dashboard platform.",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=_docs,
        redoc_url=_redoc,
        openapi_url="/openapi.json" if settings.DEMO_MODE else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        # Bearer-token auth (no cookies) — credentials not needed; scope methods/headers.
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Lang"],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        # Per-request UI language (frontend sends X-Lang) → localizes error messages
        # and drives the AI "respond in language" directive.
        i18n.set_request_lang(request.headers.get("X-Lang"))
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
        _apply_security_headers(response)
        return response

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI's default 422 echoes the submitted `input` (and `ctx`) back — that
        # reflects secrets like a rejected password. Return only the location + reason.
        request_id = getattr(request.state, "request_id", None)
        errors = [
            {"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")}
            for e in exc.errors()
        ]
        resp = JSONResponse(
            status_code=422,
            content={
                "error": "ValidationError",
                "message": i18n.localize("Daxil edilən məlumat düzgün deyil."),
                "detail": errors,
                "request_id": request_id,
            },
        )
        _apply_security_headers(resp)
        return resp

    @app.exception_handler(NexusBIException)
    async def _domain_error(request: Request, exc: NexusBIException) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        log.warning("domain_error", error=exc.__class__.__name__, message=exc.message)
        resp = JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.__class__.__name__,
                "message": i18n.localize(exc.message),
                # detail often carries raw upstream/driver text (host, port, engine
                # internals) — expose it only in demo, like the generated SQL below.
                "detail": exc.detail if settings.DEMO_MODE else None,
                "code": getattr(exc, "code", None),
                "sql": getattr(exc, "sql", None) if settings.DEMO_MODE else None,
                "request_id": request_id,
            },
        )
        _apply_security_headers(resp)
        return resp

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        log.error("unhandled_error", error=type(exc).__name__, message=str(exc))
        resp = JSONResponse(
            status_code=500,
            content={
                "error": "InternalServerError",
                "message": i18n.localize("Daxili xəta baş verdi."),
                "detail": None,
                "request_id": request_id,
            },
        )
        # This handler runs in ServerErrorMiddleware (outside the header middleware),
        # so set the headers here too — otherwise 500s ship bare.
        _apply_security_headers(resp)
        return resp

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, object]:
        return {"status": "ok", "demo_mode": settings.DEMO_MODE}

    @app.get("/metrics", tags=["health"])
    async def prometheus_metrics(request: Request) -> Response:
        # Metrics leak request patterns. A loopback check is only trustworthy in
        # demo (no proxy in front); in production a reverse proxy makes every
        # client look like 127.0.0.1, so there require the scrape token instead.
        import hmac

        client = request.client.host if request.client else ""
        token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        token_ok = bool(settings.METRICS_TOKEN) and hmac.compare_digest(
            token, settings.METRICS_TOKEN
        )
        loopback_ok = settings.DEMO_MODE and client in ("127.0.0.1", "::1")
        if not (token_ok or loopback_ok):
            return Response(status_code=403)
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(api_router)

    from app.api.v1 import ws
    app.include_router(ws.router, prefix="/ws")
    return app


app = create_app()
