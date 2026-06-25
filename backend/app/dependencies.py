"""Shared FastAPI dependencies: DB session, cache, current user."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthError
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models.user import User
from app.services.cache_service import CacheService

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

DbDep = Annotated[AsyncSession, Depends(get_db)]


def get_cache(request: Request) -> CacheService:
    """Return the app-wide cache built during startup."""
    cache: CacheService | None = getattr(request.app.state, "cache", None)
    return cache or CacheService(None)


CacheDep = Annotated[CacheService, Depends(get_cache)]


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)], db: DbDep
) -> User:
    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise AuthError("Token subyekti yoxdur.")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise AuthError("İstifadəçi tapılmadı və ya deaktivdir.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def enforce_rate_limit(
    user: Annotated[User, Depends(get_current_user)], db: DbDep
) -> User:
    """Consume one monthly AI quota unit or raise 429. Use on AI endpoints."""
    from app.billing import usage_service

    await usage_service.check_and_consume(db, user)
    return user


RateLimitedUser = Annotated[User, Depends(enforce_rate_limit)]
