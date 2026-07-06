"""Agentic BI copilot: a bounded tool-calling loop over existing services.

The model can drive every product feature — queries, dashboards, AutoML,
BA Studio, snapshots, A/B tests, decisions, insights, data
contracts, the metric tree / twin simulation, alerts. Every tool is owner-scoped
(the user_id is injected by the loop, never taken from the model) and the loop
is hard-capped at COPILOT_MAX_STEPS so it always terminates. Tools add no new
business logic; they delegate to the services, which already enforce ownership
and guards. DELETE operations are deliberately NOT exposed (destructive actions
stay in the UI); heavy generators are capped per turn (see _HEAVY_TOOLS).
Tool results are always small summary dicts — row payloads stay in the DB and
are referenced by id.
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
    "Sən NexusBI platformasının köməkçi agentisən. İstifadəçinin adından platformanın "
    "İSTƏNİLƏN funksiyasını icra edirsən: sorğu, dashboard, AutoML modeli, BA çərçivəsi "
    "(SWOT/Porter/BCG/BPMN), kohort/funnel, snapshot, A/B test, qərar, kəşf skanı, data "
    "müqaviləsi, metrik ağacı simulyasiyası, alert. Bir obyektin id-si lazımdırsa, əvvəl "
    "uyğun list_* və ya search_assets aləti ilə tap — id UYDURMA. Ağır əməliyyatı "
    "(model öyrətmə, AI generasiya) bir dəfə çağır, təkrarlama. Uydurma rəqəm vermə — "
    "yalnız alətlərin qaytardığına istinad et. İstifadəçinin dilində qısa, aydın cavab "
    "ver; iş bitəndə nəticənin əsas rəqəmlərini bir-iki cümlə ilə yekunla."
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
    # ── Kəşf alətləri (id-ləri tapmaq üçün — id uydurulmur) ──
    {
        "type": "function",
        "function": {
            "name": "search_assets",
            "description": "İstifadəçinin aktivlərini (dashboard/metrik/hesabat) ada görə semantik axtarır; kind + ref_id qaytarır.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_ml_models",
            "description": "İstifadəçinin öyrədilmiş AutoML modellərini siyahılayır (id, ad, tip, metrikalar).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_experiments",
            "description": "A/B eksperimentlərini siyahılayır (id, ad, status).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_decisions",
            "description": "Qərar jurnalını siyahılayır (id, başlıq, status).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_contracts",
            "description": "Data müqavilələrini siyahılayır (id, ad, son status).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_saved_queries",
            "description": "Saxlanmış sorğuları/hesabatları siyahılayır (id, ad, cədvəl).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    # ── AutoML ──
    {
        "type": "function",
        "function": {
            "name": "train_ml_model",
            "description": "Demo cədvəli üzərində AutoML modeli öyrədir (Linear/RandomForest holdout seçimi); metrikalar + feature əhəmiyyəti qaytarır. AĞIR əməliyyatdır — bir istək üçün bir dəfə çağır.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Model adı (boş buraxıla bilər)."},
                    "source_table": {"type": "string", "description": "Demo cədvəli: sales, customers, products, events."},
                    "target_column": {"type": "string", "description": "Proqnozlanacaq sütun."},
                },
                "required": ["source_table", "target_column"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "predict_ml",
            "description": "Öyrədilmiş modellə bir sətir üçün proqnoz verir. model_id-ni list_ml_models-dən götür.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_id": {"type": "string"},
                    "row": {
                        "type": "object",
                        "description": "Feature dəyərləri, məs. {\"quantity\": 10, \"region\": \"North\"}.",
                    },
                },
                "required": ["model_id", "row"],
            },
        },
    },
    # ── BA Studio ──
    {
        "type": "function",
        "function": {
            "name": "generate_ba_artifact",
            "description": "BA çərçivəsi qurur və saxlayır: swot | porter | bcg | bpmn. AĞIR əməliyyatdır — bir dəfə çağır.",
            "parameters": {
                "type": "object",
                "properties": {
                    "framework": {"type": "string", "enum": ["swot", "porter", "bcg", "bpmn"]},
                    "title": {"type": "string"},
                    "context": {"type": "string", "description": "Biznes konteksti (bcg üçün opsional)."},
                },
                "required": ["framework"],
            },
        },
    },
    # ── Snapshot / Zaman maşını ──
    {
        "type": "function",
        "function": {
            "name": "capture_snapshot",
            "description": "Dashboard-un hazırkı vəziyyətinin snapshot-unu çəkir (zaman maşını).",
            "parameters": {
                "type": "object",
                "properties": {
                    "dashboard_id": {"type": "string"},
                    "label": {"type": "string"},
                },
                "required": ["dashboard_id"],
            },
        },
    },
    # ── A/B test ──
    {
        "type": "function",
        "function": {
            "name": "create_experiment",
            "description": "A/B eksperimenti yaradır və dərhal analiz edir. kind=conversion → data={a:{n,conversions},b:{n,conversions}}; kind=mean → data={a:{n,mean,sd},b:{n,mean,sd}}.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "kind": {"type": "string", "enum": ["conversion", "mean"]},
                    "a_label": {"type": "string"},
                    "b_label": {"type": "string"},
                    "data": {"type": "object"},
                },
                "required": ["name", "kind", "data"],
            },
        },
    },
    # ── Qərarlar ──
    {
        "type": "function",
        "function": {
            "name": "create_decision",
            "description": "Qərar jurnalına yeni qərar yazır (insight → action).",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "insight": {"type": "string"},
                    "action": {"type": "string"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "measure_decision",
            "description": "Metrikə bağlı qərarın real dəyərini indi ölçür (ROI döngüsü). decision_id-ni list_decisions-dən götür.",
            "parameters": {
                "type": "object",
                "properties": {"decision_id": {"type": "string"}},
                "required": ["decision_id"],
            },
        },
    },
    # ── Kəşflər / Data müqaviləsi ──
    {
        "type": "function",
        "function": {
            "name": "scan_insights",
            "description": "Son nəticələri skan edib yeni kəşflər (dominantlıq/konsentrasiya/outlier) tapır.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_data_contract",
            "description": "Data müqaviləsini indi yoxlayır (keyfiyyət qaydaları). contract_id-ni list_contracts-dan götür.",
            "parameters": {
                "type": "object",
                "properties": {"contract_id": {"type": "string"}},
                "required": ["contract_id"],
            },
        },
    },
    # ── Metrik ağacı / Digital Twin ──
    {
        "type": "function",
        "function": {
            "name": "evaluate_metric_tree",
            "description": "Metrik ağacını (KPI dekompozisiyası) hesablayır — root-lar, dəyərlər, leaf-lər.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_metric_tree",
            "description": "Digital Twin ssenarisi: leaf metrikləri ADLA ±% dəyişdirib KPI-lara təsirini hesablayır. Əvvəl evaluate_metric_tree ilə leaf adlarını öyrən.",
            "parameters": {
                "type": "object",
                "properties": {
                    "changes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "leaf_name": {"type": "string"},
                                "pct": {"type": "number", "description": "Faiz dəyişikliyi, məs. 10 və ya -20."},
                            },
                            "required": ["leaf_name", "pct"],
                        },
                    },
                },
                "required": ["changes"],
            },
        },
    },
    # ── Alert ──
    {
        "type": "function",
        "function": {
            "name": "create_alert",
            "description": "Saxlanmış sorğu üzərində hədd alerti qurur (sütun + operator + hədd). saved_query_id-ni list_saved_queries-dən götür.",
            "parameters": {
                "type": "object",
                "properties": {
                    "saved_query_id": {"type": "string"},
                    "name": {"type": "string"},
                    "column": {"type": "string"},
                    "operator": {"type": "string", "enum": [">", "<", ">=", "<=", "==", "!="]},
                    "threshold": {"type": "number"},
                },
                "required": ["saved_query_id", "name", "column", "operator", "threshold"],
            },
        },
    },
]

# Heavy generators: expensive (CPU/AI) — capped PER TOOL per turn so a looping
# model can't train five models on one quota unit, while "train a model AND
# build two dashboards" still fits in one turn.
_HEAVY_TOOLS = {"train_ml_model", "generate_ba_artifact", "generate_dashboard"}
_HEAVY_LIMIT = 2
# Copilot tools that mirror per-IP-guarded endpoints share those endpoints'
# rate buckets — the agent path must not become a limiter bypass.
_IP_BUCKETS = {"train_ml_model": ("automl_train", 5, 60), "predict_ml": ("automl_predict", 30, 60)}


class _ToolContext:
    """Owner-scoped execution context shared by every tool call in one turn."""

    def __init__(
        self, db: AsyncSession, cache: CacheService, user_id: str, client_ip: str = ""
    ) -> None:
        self.db = db
        self.cache = cache
        self.user_id = user_id
        self.client_ip = client_ip
        self.actions: list[dict[str, Any]] = []
        self.heavy_calls: dict[str, int] = {}

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

    # ── Kəşf alətləri ──

    async def search_assets(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.ai import search as asset_search

        query = str(args.get("query") or "").strip()
        if not query:
            return {"error": "Axtarış sorğusu boşdur."}
        hits = await asset_search.search_assets(self.db, query, self.user_id, limit=5)
        return {"hits": [{"kind": h.kind, "ref_id": h.ref_id, "title": h.title} for h in hits]}

    async def list_ml_models(self, _args: dict[str, Any]) -> dict[str, Any]:
        from app.services import automl_service

        models = await automl_service.list_for_user(self.db, self.user_id)
        return {
            "models": [
                {
                    "id": m.id, "name": m.name, "problem_type": m.problem_type,
                    "target": m.target_column, "metrics": m.metrics,
                }
                for m in models[:20]
            ]
        }

    async def list_experiments(self, _args: dict[str, Any]) -> dict[str, Any]:
        from app.services import ab_service

        exps = await ab_service.list_for(self.db, self.user_id)
        return {"experiments": [{"id": e.id, "name": e.name, "status": e.status} for e in exps[:20]]}

    async def list_decisions(self, _args: dict[str, Any]) -> dict[str, Any]:
        from app.services import decision_service

        items = await decision_service.list_for_user(self.db, self.user_id)
        return {"decisions": [{"id": d.id, "title": d.title, "status": d.status} for d in items[:20]]}

    async def list_contracts(self, _args: dict[str, Any]) -> dict[str, Any]:
        from app.services import data_contract_service

        items = await data_contract_service.list_for(self.db, self.user_id)
        return {"contracts": [{"id": c.id, "name": c.name, "last_status": c.last_status} for c in items[:20]]}

    async def list_saved_queries(self, _args: dict[str, Any]) -> dict[str, Any]:
        from app.services import saved_query_service

        items = await saved_query_service.list_for_user(self.db, self.user_id)
        return {"saved_queries": [{"id": s.id, "name": s.name, "schedule": s.schedule} for s in items[:20]]}

    # ── AutoML ──

    async def train_ml_model(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.services import automl_service

        table = str(args.get("source_table") or "").strip()
        target = str(args.get("target_column") or "").strip()
        if not table or not target:
            return {"error": "source_table və target_column tələb olunur."}
        model = await automl_service.train(
            self.db, self.cache, self.user_id,
            str(args.get("name") or ""), table, None, target,
        )
        self.actions.append(
            {"type": "ml_model", "label": f"Model öyrədildi: {model.name}", "ml_model_id": model.id}
        )
        return {
            "ml_model_id": model.id,
            "problem_type": model.problem_type,
            "best_algo": model.best_algo,
            "metrics": model.metrics,
            "top_features": (model.importances or [])[:5],
            "row_count": model.row_count,
        }

    async def predict_ml(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.services import automl_service

        model_id = str(args.get("model_id") or "")
        row = args.get("row")
        if not model_id or not isinstance(row, dict) or not row:
            return {"error": "model_id və dolu row tələb olunur."}
        preds = await automl_service.predict(self.db, self.user_id, model_id, [row])
        self.actions.append(
            {"type": "ml_model", "label": "Proqnoz verildi", "ml_model_id": model_id}
        )
        return {"prediction": preds[0] if preds else None}

    # ── BA Studio ──

    async def generate_ba_artifact(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.services import ba_service

        framework = str(args.get("framework") or "").strip().lower()
        if framework not in ("swot", "porter", "bcg", "bpmn"):
            return {"error": "framework swot|porter|bcg|bpmn olmalıdır."}
        artifact = await ba_service.generate(
            self.db, self.user_id, framework,
            str(args.get("title") or ""), str(args.get("context") or ""),
        )
        self.actions.append(
            {"type": "ba_artifact", "label": f"BA artefaktı: {artifact.title}", "ba_artifact_id": artifact.id}
        )
        c = artifact.content or {}
        # Summary only — the mermaid source / full lists stay in the artifact.
        # .get() everywhere: the content is AI-shaped, a missing key must not
        # turn an ALREADY-persisted artifact into a tool error.
        summary: dict[str, Any] = {"ba_artifact_id": artifact.id, "advice": c.get("advice", "")}
        if framework == "bcg":
            summary["quadrants"] = [
                {
                    "label": i.get("label"), "quadrant": i.get("quadrant"),
                    "share_pct": i.get("share_pct"), "growth_pct": i.get("growth_pct"),
                }
                for i in c.get("items", [])
                if isinstance(i, dict)
            ]
        elif framework == "swot":
            summary["items"] = {k: c.get(k, []) for k in ("strengths", "weaknesses", "opportunities", "threats")}
        elif framework == "porter":
            summary["forces"] = [
                {"key": f.get("key"), "level": f.get("level")}
                for f in c.get("forces", [])
                if isinstance(f, dict)
            ]
        else:  # bpmn
            summary["summary"] = c.get("summary", "")
            mermaid = str(c.get("mermaid") or "")
            summary["edge_count"] = mermaid.count("-->")
        return summary

    # ── Snapshot ──

    async def capture_snapshot(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.services import snapshot_service

        dashboard_id = str(args.get("dashboard_id") or "")
        if not dashboard_id:
            return {"error": "dashboard_id tələb olunur."}
        snap = await snapshot_service.capture(
            self.db, self.user_id, dashboard_id, str(args.get("label") or "")[:120]
        )
        self.actions.append(
            {"type": "snapshot", "label": "Snapshot çəkildi", "dashboard_id": dashboard_id}
        )
        return {"snapshot_id": snap.id, "widget_count": len((snap.payload or {}).get("widgets", []))}

    # ── A/B test ──

    async def create_experiment(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.schemas.experiment import ExperimentCreate
        from app.services import ab_service

        name = str(args.get("name") or "").strip()
        data = args.get("data")
        if not name or not isinstance(data, dict):
            return {"error": "name və data tələb olunur."}
        kind = args.get("kind") if args.get("kind") in ("conversion", "mean") else "conversion"
        payload = ExperimentCreate(
            name=name[:255], kind=kind,
            a_label=str(args.get("a_label") or "A")[:80],
            b_label=str(args.get("b_label") or "B")[:80],
            data=data,
        )
        exp = await ab_service.create(self.db, self.user_id, payload)
        try:
            exp = await ab_service.analyze(self.db, self.user_id, exp.id)
        except Exception as exc:
            # Analysis rejected the data (e.g. conversions > n) — don't leave an
            # orphaned never-analyzed experiment behind.
            await self.db.delete(exp)
            await self.db.flush()
            return {"error": str(exc)[:200]}
        self.actions.append(
            {"type": "experiment", "label": f"Eksperiment analiz edildi: {name}", "experiment_id": exp.id}
        )
        return {"experiment_id": exp.id, "result": exp.result}

    # ── Qərarlar ──

    async def create_decision(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.schemas.decision import DecisionCreate
        from app.services import decision_service

        title = str(args.get("title") or "").strip()
        if not title:
            return {"error": "title tələb olunur."}
        payload = DecisionCreate(
            title=title[:255],
            insight=str(args.get("insight") or "")[:4000],
            action=str(args.get("action") or "")[:4000],
        )
        d = await decision_service.create(self.db, self.cache, self.user_id, payload)
        self.actions.append(
            {"type": "decision", "label": f"Qərar yazıldı: {title}", "decision_id": d.id}
        )
        return {"decision_id": d.id, "status": d.status}

    async def measure_decision(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.services import decision_service

        decision_id = str(args.get("decision_id") or "")
        if not decision_id:
            return {"error": "decision_id tələb olunur."}
        d = await decision_service.get(self.db, self.user_id, decision_id)
        if not d.metric_query:
            return {"error": "Bu qərar metrikə bağlanmayıb — ölçmək mümkün deyil."}
        d = await decision_service.measure(self.db, self.cache, d)
        self.actions.append(
            {"type": "decision", "label": f"Qərar ölçüldü: {d.title}", "decision_id": d.id}
        )
        return {
            "decision_id": d.id,
            "baseline_value": d.baseline_value,
            "realized_value": d.realized_value,
            "impact_status": d.impact_status,
        }

    # ── Kəşflər / Data müqaviləsi ──

    async def scan_insights(self, _args: dict[str, Any]) -> dict[str, Any]:
        from app.services import insight_engine

        insights = await insight_engine.scan(self.db, self.user_id)
        self.actions.append({"type": "insight", "label": f"{len(insights)} yeni kəşf"})
        return {
            "new_count": len(insights),
            "top": [{"title": i.title, "impact": i.impact_score} for i in insights[:3]],
        }

    async def run_data_contract(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.services import data_contract_service

        contract_id = str(args.get("contract_id") or "")
        if not contract_id:
            return {"error": "contract_id tələb olunur."}
        contract = await data_contract_service.run(self.db, self.cache, self.user_id, contract_id)
        self.actions.append(
            {"type": "contract", "label": f"Müqavilə yoxlanıldı: {contract.name}", "contract_id": contract.id}
        )
        return {"contract_id": contract.id, "status": contract.last_status}

    # ── Metrik ağacı / Digital Twin ──

    async def evaluate_metric_tree(self, _args: dict[str, Any]) -> dict[str, Any]:
        from app.services import metric_tree_service

        forest = await metric_tree_service.evaluate(self.db, self.user_id)

        def leaves(node: dict[str, Any]) -> list[str]:
            kids = node.get("children") or []
            if not kids:
                return [node["name"]]
            return [name for k in kids for name in leaves(k)]

        self.actions.append({"type": "metric_tree", "label": "Metrik ağacı hesablandı"})
        return {
            "roots": [
                {"name": r["name"], "value": r["value"], "leaves": leaves(r)} for r in forest
            ]
        }

    async def simulate_metric_tree(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.services import metric_tree_service

        changes = args.get("changes")
        if not isinstance(changes, list) or not changes:
            return {"error": "changes siyahısı tələb olunur."}
        out = await metric_tree_service.simulate(self.db, self.user_id, changes)
        if not out["results"]:
            return {"error": "Metrik ağacı boşdur — əvvəl KPI dekompozisiyası qurun."}
        self.actions.append({"type": "twin", "label": "Twin ssenarisi hesablandı"})
        return out

    # ── Alert ──

    async def create_alert(self, args: dict[str, Any]) -> dict[str, Any]:
        from app.schemas.alert import AlertCreate
        from app.services import alert_service

        try:
            payload = AlertCreate(
                saved_query_id=str(args.get("saved_query_id") or ""),
                name=str(args.get("name") or "")[:255],
                column=str(args.get("column") or "")[:255],
                operator=args.get("operator"),
                threshold=float(args.get("threshold") or 0),
            )
        except Exception:  # noqa: BLE001 — model sent malformed args
            return {"error": "Alert parametrləri yanlışdır (operator >,<,>=,<=,==,!= olmalıdır)."}
        alert = await alert_service.create(self.db, self.user_id, payload)
        self.actions.append(
            {"type": "alert", "label": f"Alert quruldu: {alert.name}", "saved_query_id": alert.saved_query_id}
        )
        return {"alert_id": alert.id, "name": alert.name}

    async def dispatch(self, name: str, args: dict[str, Any]) -> dict[str, Any]:
        from app.core.rate_limit import check_ip

        # Only names declared in TOOLS are dispatchable — getattr on arbitrary
        # model-supplied strings must never reach non-tool attributes.
        if name not in _TOOL_NAME_SET:
            return {"error": f"Naməlum alət: {name}"}
        if name in _HEAVY_TOOLS:
            if self.heavy_calls.get(name, 0) >= _HEAVY_LIMIT:
                return {"error": f"Bir söhbətdə '{name}' ən çox {_HEAVY_LIMIT} dəfə icra oluna bilər."}
            self.heavy_calls[name] = self.heavy_calls.get(name, 0) + 1
        bucket = _IP_BUCKETS.get(name)
        if bucket and self.client_ip and not check_ip(bucket[0], self.client_ip, bucket[1], bucket[2]):
            return {"error": "Bu əməliyyat üçün sürət həddi keçildi — bir az sonra yenidən cəhd edin."}
        return await getattr(self, name)(args)


# Derive the allowed-tool list from TOOLS so the planner can never desync from
# what execute() can actually run.
_TOOL_NAME_SET = {t["function"]["name"] for t in TOOLS}
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
    client_ip: str = "",
) -> dict[str, Any]:
    """Run one copilot turn. Returns {reply, actions, steps}.

    ``approved_plan`` (from a prior plan() the user approved) is injected so the
    executor follows the approved steps instead of re-planning freely.
    ``client_ip`` feeds the shared per-IP buckets of endpoint-guarded tools.
    """
    ctx = _ToolContext(db, cache, user_id, client_ip)
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
