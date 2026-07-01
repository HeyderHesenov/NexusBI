"""Real SMTP send-path test — INTEGRATIONS_LIVE against an in-process aiosmtpd sink.

Exercises the actual delivery pipeline (EHLO, opportunistic-STARTTLS skip on a sink
that doesn't advertise it, send_message with a PDF attachment) end-to-end with no
external credentials, so the report-delivery path can't silently rot.
"""
from __future__ import annotations

import email
from email import policy

import pytest

pytest.importorskip("aiosmtpd")
from aiosmtpd.controller import Controller  # noqa: E402

pytestmark = pytest.mark.asyncio

_SINK_PORT = 8125


class _Sink:
    def __init__(self) -> None:
        self.raw: list[bytes] = []

    async def handle_DATA(self, server, session, envelope):  # noqa: ANN001
        self.raw.append(envelope.content)
        return "250 Message accepted"


async def test_real_smtp_delivery_with_pdf_attachment(monkeypatch):
    from app.services import integrations, report_renderer

    sink = _Sink()
    controller = Controller(sink, hostname="127.0.0.1", port=_SINK_PORT)
    controller.start()
    try:
        monkeypatch.setattr(integrations.settings, "INTEGRATIONS_LIVE", True)
        monkeypatch.setattr(integrations.settings, "SMTP_HOST", "127.0.0.1")
        monkeypatch.setattr(integrations.settings, "SMTP_PORT", _SINK_PORT)
        monkeypatch.setattr(integrations.settings, "SMTP_USERNAME", "")
        monkeypatch.setattr(integrations.settings, "SMTP_FROM", "reports@nexusbi.io")

        attachment = report_renderer.render("pdf", "Satış", ["region"], [{"region": "North"}])
        ok = await integrations.deliver_report(
            "boss@corp.com", "NexusBI — Satış", "Hesabat əlavə olundu.", attachment
        )
        assert ok is True
    finally:
        controller.stop()

    assert sink.raw, "sink received no message"
    msg = email.message_from_bytes(sink.raw[0], policy=policy.default)
    assert msg["To"] == "boss@corp.com"
    assert msg["From"] == "reports@nexusbi.io"
    assert "Satış" in msg["Subject"]
    atts = list(msg.iter_attachments())
    assert len(atts) == 1
    assert atts[0].get_content_type() == "application/pdf"
    assert atts[0].get_content()[:4] == b"%PDF"


async def test_smtp_refuses_cleartext_credentials(monkeypatch):
    """Credentials must never be sent to a server without TLS/SSL (the sink has none)."""
    from app.services import integrations, report_renderer

    sink = _Sink()
    controller = Controller(sink, hostname="127.0.0.1", port=_SINK_PORT)
    controller.start()
    try:
        monkeypatch.setattr(integrations.settings, "INTEGRATIONS_LIVE", True)
        monkeypatch.setattr(integrations.settings, "SMTP_HOST", "127.0.0.1")
        monkeypatch.setattr(integrations.settings, "SMTP_PORT", _SINK_PORT)
        monkeypatch.setattr(integrations.settings, "SMTP_USERNAME", "user")
        monkeypatch.setattr(integrations.settings, "SMTP_PASSWORD", "secret")

        attachment = report_renderer.render("pdf", "Satış", ["region"], [{"region": "North"}])
        # deliver_report swallows the RuntimeError and reports failure (not delivered).
        ok = await integrations.deliver_report("boss@corp.com", "s", "b", attachment)
        assert ok is False
    finally:
        controller.stop()
    assert not sink.raw  # nothing sent — creds were not leaked in cleartext
