"""Authentication endpoints."""
from __future__ import annotations

import asyncio
import secrets

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.core.exceptions import AuthError, NexusBIException
from app.core.rate_limit import rate_limit
from app.core.google import google_enabled, verify_google_token
from app.core.security import hash_password, verify_password
from app.dependencies import CurrentUser, DbDep
from app.models.user import User
from app.schemas.auth import (
    GoogleAuthRequest,
    LoginRequest,
    ProvidersResponse,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services import auth_token_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("register", limit=5, window_seconds=60))],
)
async def register(payload: RegisterRequest, db: DbDep) -> TokenResponse:
    existing = await db.execute(select(User).where(User.email == payload.email))
    if existing.scalar_one_or_none():
        raise NexusBIException("Bu email artıq qeydiyyatdadır.")
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
    )
    db.add(user)
    try:
        await db.flush()
        await db.refresh(user)
    except IntegrityError:
        # Lost the race against a concurrent registration with the same email.
        await db.rollback()
        raise NexusBIException("Bu email artıq qeydiyyatdadır.") from None
    return TokenResponse(**await auth_token_service.issue_pair(db, user.id))


@router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(rate_limit("login", limit=10, window_seconds=60))],
)
async def login(payload: LoginRequest, db: DbDep) -> TokenResponse:
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise AuthError("Email və ya şifrə yanlışdır.")
    return TokenResponse(**await auth_token_service.issue_pair(db, user.id))


@router.post(
    "/refresh",
    response_model=TokenResponse,
    dependencies=[Depends(rate_limit("refresh", limit=30, window_seconds=60))],
)
async def refresh(payload: RefreshRequest, db: DbDep) -> TokenResponse:
    return TokenResponse(**await auth_token_service.rotate(db, payload.refresh_token))


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(rate_limit("logout", limit=20, window_seconds=60))],
)
async def logout(payload: RefreshRequest, db: DbDep) -> Response:
    await auth_token_service.revoke(db, payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/providers", response_model=ProvidersResponse)
async def providers() -> ProvidersResponse:
    enabled = google_enabled()
    return ProvidersResponse(
        google_enabled=enabled,
        google_client_id=settings.GOOGLE_CLIENT_ID or None if enabled else None,
    )


@router.post("/google", response_model=TokenResponse)
async def google_login(payload: GoogleAuthRequest, db: DbDep) -> TokenResponse:
    # verify_oauth2_token does blocking network I/O — keep it off the event loop.
    profile = await asyncio.to_thread(verify_google_token, payload.credential)

    async def _find() -> User | None:
        result = await db.execute(select(User).where(User.email == profile["email"]))
        return result.scalar_one_or_none()

    user = await _find()
    if user is None:
        # New Google user — set an unusable random password hash.
        user = User(
            email=profile["email"],
            hashed_password=hash_password(secrets.token_urlsafe(32)),
            full_name=profile["name"],
        )
        db.add(user)
        try:
            await db.flush()
            await db.refresh(user)
        except IntegrityError:
            # Concurrent first login created the same user — reuse the winner.
            await db.rollback()
            user = await _find()
            if user is None:
                raise
    return TokenResponse(**await auth_token_service.issue_pair(db, user.id))


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_active=user.is_active,
        subscription_tier=user.subscription_tier,
    )
