"""Outbound delivery to Slack / Teams / email — mock-first, config-gated.

When settings.INTEGRATIONS_LIVE is False (default, incl. demo) deliveries are
mocked (logged) so nothing leaves the box. Set it True with real webhooks / SMTP
to actually send. Webhook URLs are SSRF-checked at channel creation.
"""
from __future__ import annotations

import asyncio

from app.config import settings
from app.core.logging import get_logger

_log = get_logger("nexusbi.integrations")
TYPES = ("slack", "teams", "email")


async def _post_webhook(url: str, text: str) -> bool:
    import asyncio

    import httpx

    from app.core import net_guard

    # Re-check at delivery time too (narrows the DNS-rebind window — the stored
    # URL was validated at create, but DNS could have been re-pointed since).
    await asyncio.to_thread(net_guard.assert_safe_connection_string, url)
    # Never follow redirects — a 3xx Location could point at an internal host.
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
        resp = await client.post(url, json={"text": text})
        return 200 <= resp.status_code < 300


def _send_email(
    to_addr: str,
    subject: str,
    body: str,
    attachment: tuple[bytes, str, str] | None = None,
) -> bool:
    """Send an email, optionally with one attachment (bytes, filename, mime)."""
    import smtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)
    if attachment is not None:
        data, filename, mime = attachment
        maintype, _, subtype = mime.partition("/")
        msg.add_attachment(data, maintype=maintype or "application", subtype=subtype or "octet-stream", filename=filename)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
        server.starttls()
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.send_message(msg)
    return True


async def deliver_report(
    recipient: str, subject: str, body: str, attachment: tuple[bytes, str, str]
) -> bool:
    """Email a rendered report as an attachment. Best-effort; mock-gated like deliver()."""
    if not settings.INTEGRATIONS_LIVE:
        _log.info("report_mock_delivery", to=recipient[:60], file=attachment[1], subject=subject[:80])
        return True
    try:
        return await asyncio.to_thread(_send_email, recipient, subject, body, attachment)
    except Exception as exc:  # noqa: BLE001 — delivery is best-effort
        _log.warning("report_delivery_failed", error=str(exc)[:200])
        return False


async def deliver(channel_type: str, target: str, title: str, body: str) -> bool:
    """Deliver one message. Best-effort: returns False on failure, never raises."""
    text = f"*{title}*\n{body}" if title else body
    if not settings.INTEGRATIONS_LIVE:
        _log.info("integration_mock_delivery", type=channel_type, title=title[:80])
        return True
    try:
        if channel_type in ("slack", "teams"):
            return await _post_webhook(target, text)
        if channel_type == "email":
            return await asyncio.to_thread(_send_email, target, title or "NexusBI", body)
    except Exception as exc:  # noqa: BLE001 — delivery is best-effort
        _log.warning("integration_delivery_failed", type=channel_type, error=str(exc)[:200])
        return False
    return False
