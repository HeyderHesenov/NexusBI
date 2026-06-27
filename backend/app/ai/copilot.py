"""Agentic BI copilot: a bounded tool-calling loop over existing services.

The model can run NL queries, create / AI-generate dashboards, add widgets, and
list dashboards — every tool is owner-scoped (the user_id is injected by the
loop, never taken from the model) and the loop is hard-capped at COPILOT_MAX_STEPS
so it always terminates. Tools add no new business logic; they delegate to
query_service / dashboard_service, which already enforce ownership and guards.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import chat_tools
from app.config import settings
from app.core.logging import get_logger
from app.services import dashboard_service, query_service
from app.services.cache_service import CacheService

_log = get_logger("nexusbi.copilot")

SYSTEM_PROMPT = (
    "Sən NexusBI platformasının köməkçi agentisən. İstifadəçinin biznes data "
    "suallarını cavablandırır və onun adından dashboard qurursan. Lazım olduqda "
    "verilən alətləri çağır: sorğu işlət, dashboard yarat və ya AI ilə qur, widget "
    "əlavə et, dashboard-ları siyahıla. Bir məqsəd üçün addımları ardıcıl at "
    "(məs. əvvəl sorğu işlət, sonra onun nəticəsini dashboard-a widget kimi əlavə et). "
    "Uydurma rəqəm vermə — yalnız alətlərin qaytardığına istinad et. İstifadəçinin "
    "dilində qısa, aydın cavab ver. İş bitəndə nə etdiyini bir-iki cümlə ilə yekunla."
)

# OpenAI tool (function) schemas exposed to the model.
TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "run_query",
            "description": "Təbii dildə data sualını işlət; nəticə + query_log_id qaytarır.",
            "parameters": {
                "type": "object",
                "properties": {
                    "nl": {"type": "string", "description": "Təbii dildə sual."},
                    "datasource_id": {
                        "type": "string",
                        "description": "Mənbə id-si; demo üçün boş burax.",
                    },
                },
                "required": ["nl"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_dashboard",
            "description": "Boş dashboard yaradır; dashboard_id qaytarır.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_dashboard",
            "description": "Bir məqsəd üçün AI tam dashboard qurur (bir neçə widget).",
            "parameters": {
                "type": "object",
                "properties": {
                    "goal": {"type": "string"},
                    "datasource_id": {"type": "string"},
                },
                "required": ["goal"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_widget",
            "description": "Mövcud sorğu nəticəsini (query_log_id) dashboard-a widget kimi əlavə edir.",
            "parameters": {
                "type": "object",
                "properties": {
                    "dashboard_id": {"type": "string"},
                    "query_log_id": {"type": "string"},
                    "title": {"type": "string"},
                },
                "required": ["dashboard_id", "query_log_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dashboards",
            "description": "İstifadəçinin dashboard-larını siyahılayır.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


class _ToolContext:
    """Owner-scoped execution context shared by every tool call in one turn."""

    def __init__(self, db: AsyncSession, cache: CacheService, user_id: str) -> None:
        self.db = db
        self.cache = cache
        self.user_id = user_id
        self.actions: list[dict[str, Any]] = []

    async def run_query(self, args: dict[str, Any]) -> dict[str, Any]:
        nl = str(args.get("nl") or "").strip()
        if not nl:
            return {"error": "Sual boşdur."}
        ds = args.get("datasource_id") or None
        result = await query_service.process_nl_query(
            nl, ds, self.user_id, self.db, self.cache
        )
        self.actions.append(
            {"type": "query", "label": f"Sorğu işlədildi: {nl}", "query_log_id": result.query_log_id}
        )
        return {
            "query_log_id": result.query_log_id,
            "chart_type": result.chart_config.chart_type,
            "insight": result.insight,
            "row_count": len(result.data),
        }

    async def create_dashboard(self, args: dict[str, Any]) -> dict[str, Any]:
        name = str(args.get("name") or "Yeni dashboard").strip()[:255]
        dash = await dashboard_service.create_dashboard(
            self.db, self.user_id, name, str(args.get("description") or "")[:2000]
        )
        self.actions.append(
            {"type": "dashboard", "label": f"Dashboard yaradıldı: {name}", "dashboard_id": dash.id}
        )
        return {"dashboard_id": dash.id, "name": dash.name}

    async def generate_dashboard(self, args: dict[str, Any]) -> dict[str, Any]:
        goal = str(args.get("goal") or "").strip()
        if not goal:
            return {"error": "Məqsəd boşdur."}
        ds = args.get("datasource_id") or None
        dash = await dashboard_service.generate_dashboard(
            self.db, self.cache, self.user_id, goal, ds
        )
        self.actions.append(
            {
                "type": "dashboard",
                "label": f"AI dashboard quruldu: {dash.name}",
                "dashboard_id": dash.id,
            }
        )
        return {"dashboard_id": dash.id, "name": dash.name, "widget_count": len(dash.widgets)}

    async def add_widget(self, args: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = str(args.get("dashboard_id") or "")
        query_log_id = str(args.get("query_log_id") or "")
        if not dashboard_id or not query_log_id:
            return {"error": "dashboard_id və query_log_id tələb olunur."}
        widget = await dashboard_service.add_widget(
            self.db,
            self.user_id,
            dashboard_id,
            {"query_log_id": query_log_id, "title": str(args.get("title") or "")[:255]},
        )
        self.actions.append(
            {"type": "widget", "label": "Widget əlavə edildi", "dashboard_id": dashboard_id}
        )
        return {"widget_id": widget.id}

    async def list_dashboards(self, _args: dict[str, Any]) -> dict[str, Any]:
        items = await dashboard_service.list_dashboards(self.db, self.user_id)
        return {"dashboards": [{"id": d.id, "name": d.name} for d in items]}

    async def dispatch(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        handler = getattr(self, name, None)
        if handler is None:
            return {"error": f"Naməlum alət: {name}"}
        return await handler(args)


async def run(
    message: str,
    history: list[dict[str, str]],
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
) -> dict[str, Any]:
    """Run one copilot turn. Returns {reply, actions, steps}."""
    ctx = _ToolContext(db, cache, user_id)
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    # Only user/assistant turns from prior history (tool plumbing isn't replayed).
    for turn in history[-10:]:
        role = turn.get("role")
        if role in ("user", "assistant") and turn.get("content"):
            messages.append({"role": role, "content": turn["content"]})
    messages.append({"role": "user", "content": message})

    steps = 0
    for _ in range(settings.COPILOT_MAX_STEPS):
        steps += 1
        reply = await chat_tools(messages, TOOLS)
        tool_calls = getattr(reply, "tool_calls", None)
        if not tool_calls:
            return {"reply": (reply.content or "").strip(), "actions": ctx.actions, "steps": steps}

        # Record the assistant's tool request, then execute each call.
        messages.append(reply.model_dump(exclude_none=True))
        for call in tool_calls:
            try:
                args = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            try:
                result = await ctx.dispatch(call.function.name, args)
            except Exception as exc:  # noqa: BLE001 — surface tool failure to the model
                _log.warning("copilot_tool_failed", tool=call.function.name, error=str(exc)[:200])
                result = {"error": str(exc)[:200]}
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result, ensure_ascii=False, default=str),
                }
            )

    # Hit the step cap — summarise what was done so the turn still resolves.
    return {
        "reply": "Addım limitinə çatdım. Gördüyüm işlər aşağıdadır.",
        "actions": ctx.actions,
        "steps": steps,
    }
