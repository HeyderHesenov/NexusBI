"""Turn a dashboard into a narrated, slide-by-slide data story.

Given each widget's title/chart/insight, the model writes an executive overview,
a 2–3 sentence narrative per widget, and a few closing takeaways. The Python side
assembles the ordered slide deck so rendering stays deterministic; on any AI
failure it degrades to a rule-based narrative built from the widgets' insights.
"""
from __future__ import annotations

import json
from typing import Any

from app.ai.client import chat_json
from app.ai.prompt_templates import DATA_STORY_PROMPT, DATA_STORY_USER_PROMPT
from app.core.logging import get_logger

_log = get_logger("nexusbi.ai")

_MAX_SAMPLE_ROWS = 8  # keep the prompt small; the insight already summarises


def _widget_payload(widgets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compact each widget down to what the model needs to narrate it."""
    payload = []
    for i, w in enumerate(widgets):
        payload.append(
            {
                "index": i,
                "title": w.get("title") or w.get("natural_language") or f"Widget {i + 1}",
                "chart_type": w.get("chart_type"),
                "insight": w.get("insight") or "",
                "columns": w.get("columns") or [],
                "sample": (w.get("rows") or [])[:_MAX_SAMPLE_ROWS],
            }
        )
    return payload


def _slide(type_: str, title: str, narrative: str, widget_id: str | None = None) -> dict[str, Any]:
    return {"type": type_, "title": title, "narrative": narrative, "widget_id": widget_id}


def _fallback_story(name: str, widgets: list[dict[str, Any]]) -> dict[str, Any]:
    """Deterministic story when AI is unavailable — stitched from insights."""
    slides = [
        _slide(
            "intro",
            name,
            f"Bu panel {len(widgets)} göstərici üzərində qurulub. "
            "Aşağıda hər birinin qısa izahı verilir.",
        )
    ]
    takeaways: list[str] = []
    for w in widgets:
        title = w.get("title") or w.get("natural_language") or "Göstərici"
        insight = (w.get("insight") or "").strip() or f"{title} üzrə nəticə göstərilir."
        slides.append(_slide("chart", title, insight, w.get("widget_id")))
        if w.get("insight"):
            takeaways.append(w["insight"].strip())
    closing = " ".join(f"• {t}" for t in takeaways[:4]) or "Panel hazırdır."
    slides.append(_slide("closing", "Əsas nəticələr", closing))
    return {"title": name, "slides": slides}


async def build_story(name: str, widgets: list[dict[str, Any]]) -> dict[str, Any]:
    """Build an ordered slide deck (intro + per-widget + closing) for a dashboard.

    ``widgets`` items carry: title, natural_language, chart_type, insight,
    columns, rows, widget_id. Always returns a usable story (AI or fallback).
    """
    if not widgets:
        return {"title": name, "slides": [_slide("intro", name, "Bu panel boşdur.")]}

    try:
        user = DATA_STORY_USER_PROMPT.format(
            name=name,
            widgets=json.dumps(_widget_payload(widgets), ensure_ascii=False, default=str),
        )
        raw = await chat_json(DATA_STORY_PROMPT, user, temperature=0.5)
    except Exception as exc:  # noqa: BLE001 — never fail the story; degrade gracefully
        _log.warning("data_story_failed", error=type(exc).__name__, detail=str(exc)[:200])
        return _fallback_story(name, widgets)

    narratives = {
        s["index"]: str(s.get("narrative", "")).strip()
        for s in raw.get("slides", [])
        if isinstance(s, dict) and isinstance(s.get("index"), int)
    }

    slides = [_slide("intro", str(raw.get("title") or name), str(raw.get("overview") or "").strip())]
    for i, w in enumerate(widgets):
        title = w.get("title") or w.get("natural_language") or f"Widget {i + 1}"
        narrative = narratives.get(i) or (w.get("insight") or "").strip()
        slides.append(_slide("chart", title, narrative, w.get("widget_id")))

    takeaways = [str(t).strip() for t in raw.get("takeaways", []) if str(t).strip()]
    closing = " ".join(f"• {t}" for t in takeaways[:4])
    if closing:
        slides.append(_slide("closing", "Əsas nəticələr", closing))

    return {"title": str(raw.get("title") or name), "slides": slides}
