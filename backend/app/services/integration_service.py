"""IntegrationChannel CRUD + dispatch of notifications to a user's channels."""
from __future__ import annotations

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import net_guard
from app.core.exceptions import NexusBIException, SchemaNotFoundError
from app.core.logging import get_logger
from app.core.security import decrypt_secret, encrypt_secret
from app.models.integration import IntegrationChannel
from app.services import integrations

_log = get_logger("nexusbi.integrations")


async def create(
    db: AsyncSession, user_id: str, type_: str, name: str, target: str
) -> IntegrationChannel:
    if type_ not in integrations.TYPES:
        raise NexusBIException("Naməlum kanal tipi.")
    target = target.strip()
    if type_ in ("slack", "teams"):
        if not target.startswith(("http://", "https://")):
            raise NexusBIException("Webhook URL http(s) ilə başlamalıdır.")
        # SSRF guard — same protection as datasource connection strings.
        await asyncio.to_thread(net_guard.assert_safe_connection_string, target)
    elif type_ == "email" and "@" not in target:
        raise NexusBIException("Düzgün e-poçt ünvanı daxil edin.")

    channel = IntegrationChannel(
        user_id=user_id, type=type_, name=name[:255] or type_,
        target_encrypted=encrypt_secret(target),
    )
    db.add(channel)
    await db.flush()
    await db.refresh(channel)
    return channel


async def list_for_user(db: AsyncSession, user_id: str) -> list[IntegrationChannel]:
    res = await db.execute(
        select(IntegrationChannel)
        .where(IntegrationChannel.user_id == user_id)
        .order_by(IntegrationChannel.created_at.desc())
    )
    return list(res.scalars().all())


async def get(db: AsyncSession, user_id: str, channel_id: str) -> IntegrationChannel:
    res = await db.execute(
        select(IntegrationChannel).where(
            IntegrationChannel.id == channel_id, IntegrationChannel.user_id == user_id
        )
    )
    ch = res.scalar_one_or_none()
    if ch is None:
        raise SchemaNotFoundError("Kanal tapılmadı.")
    return ch


async def delete(db: AsyncSession, user_id: str, channel_id: str) -> None:
    ch = await get(db, user_id, channel_id)
    await db.delete(ch)
    await db.flush()


async def send_test(db: AsyncSession, user_id: str, channel_id: str) -> bool:
    ch = await get(db, user_id, channel_id)
    return await integrations.deliver(
        ch.type, decrypt_secret(ch.target_encrypted), "NexusBI test", "Bu, test bildirişidir. ✅"
    )


async def dispatch(db: AsyncSession, user_id: str, title: str, body: str) -> int:
    """Send a notification to all of the user's active channels. Returns sent count."""
    channels = [c for c in await list_for_user(db, user_id) if c.active]
    sent = 0
    for ch in channels:
        try:
            ok = await integrations.deliver(ch.type, decrypt_secret(ch.target_encrypted), title, body)
            sent += 1 if ok else 0
        except Exception as exc:  # noqa: BLE001 — never let dispatch break the caller
            _log.warning("dispatch_failed", channel=ch.id, error=str(exc)[:200])
    return sent
