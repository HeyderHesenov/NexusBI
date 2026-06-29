"""Refresh-token issuance, rotation (with reuse detection), and revocation."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
)
from app.models.refresh_token import RefreshToken


async def issue_pair(db: AsyncSession, user_id: str, family_id: str | None = None) -> dict:
    """Create a fresh access+refresh pair, persisting the refresh jti.

    A new login passes ``family_id=None`` (starts a lineage); rotation reuses the
    existing family so the whole chain can be revoked on reuse.
    """
    jti = str(uuid.uuid4())
    fam = family_id or str(uuid.uuid4())
    refresh, expires_at = create_refresh_token(user_id, jti, fam)
    db.add(
        RefreshToken(user_id=user_id, jti=jti, family_id=fam, expires_at=expires_at)
    )
    await db.flush()
    return {
        "access_token": create_access_token(user_id),
        "refresh_token": refresh,
        "token_type": "bearer",
    }


async def _revoke_family(db: AsyncSession, family_id: str) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked.is_(False))
        .values(revoked=True)
    )


async def rotate(db: AsyncSession, refresh_token: str) -> dict:
    """Validate + rotate a refresh token. Revokes the presented token and issues a
    new pair in the same family. Reuse of an already-revoked token revokes the
    entire family (stolen-token containment)."""
    payload = decode_refresh_token(refresh_token)  # raises on bad signature/expiry
    jti = payload["rt"]
    # Row lock serializes concurrent rotations of the same token (Postgres): the
    # second waits, then sees revoked=True and trips reuse detection instead of
    # minting a second live token. (No-op on SQLite, which serializes writes.)
    row = (
        await db.execute(
            select(RefreshToken).where(RefreshToken.jti == jti).with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        raise AuthError("Refresh token tapılmadı.")
    if row.revoked:
        # Replay of a rotated/revoked token → assume compromise, kill the lineage.
        # Commit in a SEPARATE session so the revocation survives the request
        # rollback that the AuthError below triggers.
        from app.db.session import AsyncSessionLocal

        async with AsyncSessionLocal() as s:
            await _revoke_family(s, row.family_id)
            await s.commit()
        raise AuthError("Refresh token təkrar istifadə aşkarlandı.")
    # SQLite returns naive datetimes — treat a naive expiry as UTC for comparison.
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        raise AuthError("Refresh token vaxtı bitib.")
    row.revoked = True  # rotate: old token can never be used again
    await db.flush()
    return await issue_pair(db, row.user_id, family_id=row.family_id)


async def revoke(db: AsyncSession, refresh_token: str) -> None:
    """Logout: best-effort revoke of the presented refresh token's family."""
    try:
        payload = decode_refresh_token(refresh_token)
    except AuthError:
        return
    row = (
        await db.execute(select(RefreshToken).where(RefreshToken.jti == payload["rt"]))
    ).scalar_one_or_none()
    if row is not None:
        await _revoke_family(db, row.family_id)
        await db.flush()
