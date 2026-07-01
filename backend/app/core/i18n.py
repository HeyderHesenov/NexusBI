"""Server-side locale: resolve the request language, localize user-facing messages,
and produce an AI language directive so NEW AI prose is generated in that language.

Language is carried per-request via the ``X-Lang`` header (the frontend sends the
active UI language). A ContextVar makes it available to services / AI callers
without threading it through every function. Default/fallback is Azerbaijani.
"""
from __future__ import annotations

from contextvars import ContextVar

SUPPORTED = ("az", "en", "ru", "tr")
DEFAULT = "az"

LANG_NAMES = {
    "az": "Azerbaijani",
    "en": "English",
    "ru": "Russian",
    "tr": "Turkish",
}

_lang: ContextVar[str] = ContextVar("request_lang", default=DEFAULT)


def resolve_lang(value: str | None) -> str:
    v = (value or "").strip().lower()[:2]
    return v if v in SUPPORTED else DEFAULT


def set_request_lang(value: str | None) -> None:
    _lang.set(resolve_lang(value))


def get_lang() -> str:
    return _lang.get()


def lang_directive() -> str:
    """Suffix appended to prose-generation prompts so the AI answers in the request
    language. Empty for Azerbaijani (the prompts are already Azerbaijani)."""
    lang = get_lang()
    if lang == DEFAULT:
        return ""
    return (
        f"\n\nIMPORTANT: Write ALL natural-language text in your response in "
        f"{LANG_NAMES[lang]}. Keep JSON keys, SQL, and identifiers unchanged."
    )


# Catalog of common user-facing exception messages (Azerbaijani source → translations).
# Unlisted messages fall through unchanged. Expand as needed.
MESSAGES: dict[str, dict[str, str]] = {
    "Daxili xəta baş verdi.": {
        "en": "An internal error occurred.",
        "ru": "Произошла внутренняя ошибка.",
        "tr": "Dahili bir hata oluştu.",
    },
    "Sorğu tapılmadı.": {
        "en": "Query not found.",
        "ru": "Запрос не найден.",
        "tr": "Sorgu bulunamadı.",
    },
    "Çox sayda cəhd. Bir az sonra yenidən yoxlayın.": {
        "en": "Too many attempts. Please try again shortly.",
        "ru": "Слишком много попыток. Повторите чуть позже.",
        "tr": "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.",
    },
    "Sorğu üçün əvvəlcə mənbə seçin.": {
        "en": "Select a data source for the query first.",
        "ru": "Сначала выберите источник данных для запроса.",
        "tr": "Sorgu için önce bir veri kaynağı seçin.",
    },
    "Power BI mənbələri əl ilə SQL dəstəkləmir (DAX istifadə olunur).": {
        "en": "Power BI sources don't support manual SQL (they use DAX).",
        "ru": "Источники Power BI не поддерживают ручной SQL (используется DAX).",
        "tr": "Power BI kaynakları manuel SQL desteklemez (DAX kullanılır).",
    },
    "Only SELECT queries are permitted.": {
        "en": "Only SELECT queries are permitted.",
        "ru": "Разрешены только запросы SELECT.",
        "tr": "Yalnızca SELECT sorgularına izin verilir.",
    },
    "İstifadəçi tapılmadı və ya deaktivdir.": {
        "en": "User not found or inactive.",
        "ru": "Пользователь не найден или неактивен.",
        "tr": "Kullanıcı bulunamadı veya devre dışı.",
    },
    "Bu token API girişi üçün etibarlı deyil.": {
        "en": "This token is not valid for API access.",
        "ru": "Этот токен недействителен для доступа к API.",
        "tr": "Bu token API erişimi için geçerli değil.",
    },
}


def localize(message: str, lang: str | None = None) -> str:
    """Translate a known user-facing message to ``lang`` (or the request language).
    Unknown messages are returned unchanged."""
    lng = lang or get_lang()
    if lng == DEFAULT:
        return message
    return MESSAGES.get(message, {}).get(lng, message)
