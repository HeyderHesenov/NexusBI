"""Server-side locale: request language, message localization, AI directive."""
from __future__ import annotations

import pytest

from app.core import i18n

pytestmark = pytest.mark.asyncio


async def test_resolve_lang_validates():
    assert i18n.resolve_lang("en") == "en"
    assert i18n.resolve_lang("RU") == "ru"
    assert i18n.resolve_lang("tr-TR") == "tr"
    assert i18n.resolve_lang("de") == "az"  # unsupported → default
    assert i18n.resolve_lang(None) == "az"


async def test_localize_known_and_unknown():
    i18n.set_request_lang("ru")
    assert i18n.localize("Sorğu tapılmadı.") == "Запрос не найден."
    assert i18n.localize("не в каталоге xyz") == "не в каталоге xyz"  # passthrough
    i18n.set_request_lang("az")
    assert i18n.localize("Sorğu tapılmadı.") == "Sorğu tapılmadı."  # default = source


async def test_lang_directive_only_for_non_default():
    i18n.set_request_lang("az")
    assert i18n.lang_directive() == ""
    i18n.set_request_lang("tr")
    d = i18n.lang_directive()
    assert "Turkish" in d
    i18n.set_request_lang("az")  # reset


async def test_error_message_localized_via_header(client, auth):
    # Non-existent query → SchemaNotFoundError("Sorğu tapılmadı.") localized to RU.
    resp = await client.get(
        "/api/v1/query/does-not-exist", headers={**auth, "X-Lang": "ru"}
    )
    assert resp.status_code == 404
    assert resp.json()["message"] == "Запрос не найден."


async def test_error_message_default_az(client, auth):
    resp = await client.get("/api/v1/query/does-not-exist", headers=auth)
    assert resp.status_code == 404
    assert resp.json()["message"] == "Sorğu tapılmadı."
