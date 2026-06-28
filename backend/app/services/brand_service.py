"""White-label brand config (per user)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.brand import BrandConfig

_DEFAULT = {"app_name": "NexusBI", "primary_color": "#0E9F6E", "logo_url": ""}


async def get(db: AsyncSession, user_id: str) -> BrandConfig | None:
    res = await db.execute(select(BrandConfig).where(BrandConfig.user_id == user_id))
    return res.scalar_one_or_none()


def as_dict(cfg: BrandConfig | None) -> dict:
    if cfg is None:
        return dict(_DEFAULT)
    return {"app_name": cfg.app_name, "primary_color": cfg.primary_color, "logo_url": cfg.logo_url}


async def upsert(db: AsyncSession, user_id: str, payload) -> BrandConfig:
    cfg = await get(db, user_id)
    if cfg is None:
        cfg = BrandConfig(user_id=user_id)
        db.add(cfg)
    for field in ("app_name", "primary_color", "logo_url"):
        value = getattr(payload, field, None)
        if value is not None:
            setattr(cfg, field, value)
    await db.flush()
    await db.refresh(cfg)
    return cfg
