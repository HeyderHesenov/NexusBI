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

from app.ai.client import chat_json, chat_tools
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

# Tool (function) schemas exposed to the AI engine.
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
    {
        "type": "function",
        "function": {
            "name": "share_dashboard",
            "description": "Dashboard üçün paylaşım linki (public token) yaradır.",
            "parameters": {
                "type": "object",
                "properties": {"dashboard_id": {"type": "string"}},
                "required": ["dashboard_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_saved_query",
            "description": "Sorğunu adla saxlayır (planlı cədvəl: off/hourly/daily/weekly).",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "nl_query": {"type": "string"},
                    "schedule": {
                        "type": "string",
                        "enum": ["off", "hourly", "daily", "weekly"],
                    },
                    "datasource_id": {"type": "string"},
                },
                "required": ["name", "nl_query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_metric",
            "description": "Semantik metrik təyin edir (ad + ifadə + sinonimlər).",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "expression": {"type": "string"},
                    "description": {"type": "string"},
                    "synonyms": {"type": "string"},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "build_digest",
            "description": "İstifadəçi üçün proaktiv 'səhər brifi' bildirişi yaradır.",
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

    async def share_dashboard(self, args: dict[str, Any]) -> dict[str, Any]:
        dashboard_id = str(args.get("dashboard_id") or "")
        if not dashboard_id:
            return {"error": "dashboard_id tələb olunur."}
        token = await dashboard_service.enable_share(self.db, self.user_id, dashboard_id)
        self.actions.append(
            {"type": "share", "label": "Paylaşım linki yaradıldı", "dashboard_id": dashboard_id}
        )
        return {"share_token": token}

    async def create_saved_query(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.schemas.saved_query import SavedQueryCreate
        from app.services import saved_query_service

        nl = str(args.get("nl_query") or "").strip()
        name = str(args.get("name") or "").strip()
        if not nl or not name:
            return {"error": "name və nl_query tələb olunur."}
        schedule = args.get("schedule") or "off"
        if schedule not in ("off", "hourly", "daily", "weekly"):
            schedule = "off"
        payload = SavedQueryCreate(
            name=name[:255], nl_query=nl[:2000],
            datasource_id=args.get("datasource_id") or None, schedule=schedule,
        )
        sq = await saved_query_service.create(self.db, self.user_id, payload)
        self.actions.append(
            {"type": "saved_query", "label": f"Sorğu saxlanıldı: {name}", "saved_query_id": sq.id}
        )
        return {"saved_query_id": sq.id, "schedule": sq.schedule}

    async def create_metric(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.schemas.metric import MetricCreate
        from app.services import metric_service

        name = str(args.get("name") or "").strip()
        if not name:
            return {"error": "Metrik adı tələb olunur."}
        payload = MetricCreate(
            name=name[:255],
            expression=str(args.get("expression") or "")[:2000],
            description=str(args.get("description") or "")[:2000],
            synonyms=str(args.get("synonyms") or "")[:500],
            datasource_id=args.get("datasource_id") or None,
        )
        metric = await metric_service.create(self.db, self.user_id, payload)
        self.actions.append(
            {"type": "metric", "label": f"Metrik təyin edildi: {name}", "metric_id": metric.id}
        )
        return {"metric_id": metric.id, "name": metric.name}

    async def build_digest(self, _args: dict[str, Any]) -> dict[str, Any]:
        from app.services import digest_service

        notif = await digest_service.build_digest(self.db, self.user_id)
        self.actions.append({"type": "digest", "label": "Səhər brifi yaradıldı"})
        return {"created": 1 if notif is not None else 0}

    async def dispatch(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        handler = getattr(self, name, None)
        if handler is None:
            return {"error": f"Naməlum alət: {name}"}
        return await handler(args)


# Derive the allowed-tool list from TOOLS so the planner can never desync from
# what execute() can actually run.
_TOOL_NAMES = ", ".join(t["function"]["name"] for t in TOOLS)

PLAN_PROMPT = (
    "Sən NexusBI agentinin planlayıcısısan. İstifadəçinin istəyini yerinə "
    "yetirmək üçün atılacaq addımları SADALA — heç nə icra etmə. Yalnız bu "
    f"alətlərdən istifadə et: {_TOOL_NAMES}. Hər addım üçün tool adı və bir cümlə "
    "izah ver. İstifadəçinin dilində qısa yekun (reply) yaz.\n\n"
    "OUTPUT FORMAT (JSON):\n"
    '{"plan": [{"tool": "generate_dashboard", "summary": "Satış üçün panel qur"}], '
    '"reply": "Bu addımları atacam."}'
)


async def plan(message: str, history: list[dict[str, str]]) -> dict[str, Any]:
    """Propose an execution plan WITHOUT running anything (for user approval)."""
    ctx = "\n".join(
        f"{t.get('role')}: {t.get('content')}"
        for t in history[-6:]
        if t.get("role") in ("user", "assistant") and t.get("content")
    )
    user = (f"ƏVVƏLKİ:\n{ctx}\n\n" if ctx else "") + f"İSTƏK: {message}"
    try:
        raw = await chat_json(PLAN_PROMPT, user, localize=True)
        steps = raw.get("plan")
        if isinstance(steps, list) and steps:
            plan_steps = [
                {"tool": str(s.get("tool") or ""), "summary": str(s.get("summary") or "")}
                for s in steps
                if isinstance(s, dict) and (s.get("tool") or s.get("summary"))
            ]
            if plan_steps:
                return {"plan": plan_steps, "reply": str(raw.get("reply") or "")}
    except Exception as exc:  # noqa: BLE001 — fall back to a trivial single-step plan
        _log.warning("copilot_plan_failed", error=type(exc).__name__, detail=str(exc)[:200])
    return {
        "plan": [{"tool": "run_query", "summary": message[:120]}],
        "reply": "Bu sualı işlədəcəm.",
    }


async def run(
    message: str,
    history: list[dict[str, str]],
    db: AsyncSession,
    cache: CacheService,
    user_id: str,
    approved_plan: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Run one copilot turn. Returns {reply, actions, steps}.

    ``approved_plan`` (from a prior plan() the user approved) is injected so the
    executor follows the approved steps instead of re-planning freely.
    """
    ctx = _ToolContext(db, cache, user_id)
    system = SYSTEM_PROMPT
    if approved_plan:
        steps_txt = "; ".join(
            f"{s.get('tool')}: {s.get('summary')}" for s in approved_plan if s.get("tool")
        )
        if steps_txt:
            system += f"\nİstifadəçi bu planı təsdiqlədi — ona uyğun icra et: {steps_txt}"
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    # Only user/assistant turns from prior history (tool plumbing isn't replayed).
    for turn in history[-10:]:
        role = turn.get("role")
        if role in ("user", "assistant") and turn.get("content"):
            messages.append({"role": role, "content": turn["content"]})
    messages.append({"role": "user", "content": message})

    steps = 0
    for _ in range(settings.COPILOT_MAX_STEPS):
        steps += 1
        reply = await chat_tools(messages, TOOLS, localize=True)
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
