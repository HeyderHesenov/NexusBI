"""Agentic copilot: tool loop, step cap, ownership, auth."""
from __future__ import annotations

from httpx import AsyncClient


# ── Fakes mimicking the AI engine tool-calling message interface ──
class _FakeFn:
    def __init__(self, name: str, arguments: str) -> None:
        self.name = name
        self.arguments = arguments


class _FakeToolCall:
    def __init__(self, call_id: str, name: str, arguments: str) -> None:
        self.id = call_id
        self.function = _FakeFn(name, arguments)


class _FakeMsg:
    def __init__(self, content=None, tool_calls=None) -> None:
        self.content = content
        self.tool_calls = tool_calls

    def model_dump(self, exclude_none: bool = False) -> dict:
        return {"role": "assistant", "content": self.content}


def _queue_messages(monkeypatch, messages: list):
    """Make copilot.chat_tools return queued fake messages in order."""
    from app.ai import copilot

    state = {"i": 0}

    async def fake_chat_tools(msgs, tools, *, temperature=0.0, localize=False):
        i = min(state["i"], len(messages) - 1)
        state["i"] += 1
        return messages[i]

    monkeypatch.setattr(copilot, "chat_tools", fake_chat_tools)


def _mock_query_ai(monkeypatch):
    from app.ai.types import ChartConfig, Text2SQLResult
    from app.services import query_service

    async def fake_sql(self, nl, schema, dtype="sqlite", extra_context=""):
        return Text2SQLResult(
            sql="SELECT category, SUM(revenue) AS total FROM sales GROUP BY category",
            explanation="x", confidence=0.9, warnings=[],
        )

    async def fake_chart(columns, data, nl):
        return ChartConfig(chart_type="bar", x_axis="category", y_axis="total")

    async def fake_insight(data, nl, chart_type=""):
        return "Elektronika öndədir."

    monkeypatch.setattr(query_service.Text2SQLEngine, "generate_sql", fake_sql)
    monkeypatch.setattr(query_service, "select_chart_type", fake_chart)
    monkeypatch.setattr(query_service, "generate_insight", fake_insight)


async def test_copilot_runs_query(client: AsyncClient, auth: dict, monkeypatch):
    _mock_query_ai(monkeypatch)
    _queue_messages(
        monkeypatch,
        [
            _FakeMsg(tool_calls=[_FakeToolCall("c1", "run_query", '{"nl": "Kateqoriya gəliri"}')]),
            _FakeMsg(content="Elektronika kateqoriyası öndədir."),
        ],
    )
    resp = await client.post(
        "/api/v1/copilot/chat", json={"message": "Kateqoriya gəlirini göstər"}, headers=auth
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["steps"] == 2
    assert "Elektronika" in body["reply"]
    assert len(body["actions"]) == 1
    assert body["actions"][0]["type"] == "query"
    assert body["actions"][0]["query_log_id"]


async def test_copilot_step_cap(client: AsyncClient, auth: dict, monkeypatch):
    from app.config import settings

    # Always return a (cheap) tool call → loop must stop at the step cap.
    _queue_messages(
        monkeypatch, [_FakeMsg(tool_calls=[_FakeToolCall("c", "list_dashboards", "{}")])]
    )
    resp = await client.post(
        "/api/v1/copilot/chat", json={"message": "döngü"}, headers=auth
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["steps"] == settings.COPILOT_MAX_STEPS


async def test_copilot_unowned_dashboard_is_safe(client: AsyncClient, auth: dict, monkeypatch):
    # add_widget to a non-existent/foreign dashboard → tool error, no action, still replies.
    _queue_messages(
        monkeypatch,
        [
            _FakeMsg(
                tool_calls=[
                    _FakeToolCall(
                        "c1",
                        "add_widget",
                        '{"dashboard_id": "00000000-0000-0000-0000-000000000000",'
                        ' "query_log_id": "00000000-0000-0000-0000-000000000000"}',
                    )
                ]
            ),
            _FakeMsg(content="Dashboard tapılmadı."),
        ],
    )
    resp = await client.post(
        "/api/v1/copilot/chat", json={"message": "widget əlavə et"}, headers=auth
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["actions"] == []


async def test_copilot_requires_auth(client: AsyncClient):
    resp = await client.post("/api/v1/copilot/chat", json={"message": "salam"})
    assert resp.status_code == 401


async def test_copilot_plan_mode(client: AsyncClient, auth: dict, monkeypatch):
    from app.ai import copilot

    async def fake_chat_json(system, user, **kw):
        return {
            "plan": [
                {"tool": "generate_dashboard", "summary": "Satış paneli qur"},
                {"tool": "share_dashboard", "summary": "Komandaya paylaş"},
            ],
            "reply": "Bu addımları atacam.",
        }

    monkeypatch.setattr(copilot, "chat_json", fake_chat_json)
    resp = await client.post(
        "/api/v1/copilot/chat",
        json={"message": "Q3 satış paneli qur və paylaş", "mode": "plan"},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["plan"]) == 2
    assert body["plan"][0]["tool"] == "generate_dashboard"
    assert body["actions"] == []  # plan never executes


async def test_copilot_creates_saved_query(client: AsyncClient, auth: dict, monkeypatch):
    _queue_messages(
        monkeypatch,
        [
            _FakeMsg(
                tool_calls=[
                    _FakeToolCall(
                        "c1",
                        "create_saved_query",
                        '{"name": "Həftəlik gəlir", "nl_query": "həftəlik gəlir", "schedule": "weekly"}',
                    )
                ]
            ),
            _FakeMsg(content="Sorğu saxlanıldı."),
        ],
    )
    resp = await client.post(
        "/api/v1/copilot/chat",
        json={"message": "həftəlik gəlir sorğusunu saxla"},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["actions"][0]["type"] == "saved_query"
    assert body["actions"][0]["saved_query_id"]


# ── Universal tool registry (studio round) ──


def test_all_new_tools_registered_with_handlers():
    from app.ai import copilot

    expected = {
        "search_assets", "list_ml_models", "list_experiments", "list_decisions",
        "list_contracts", "list_saved_queries", "train_ml_model", "predict_ml",
        "generate_ba_artifact",
        "capture_snapshot", "create_experiment", "create_decision",
        "measure_decision", "run_data_contract",
        "evaluate_metric_tree", "simulate_metric_tree", "create_alert",
    }
    assert expected <= copilot._TOOL_NAME_SET
    for name in copilot._TOOL_NAME_SET:
        assert callable(getattr(copilot._ToolContext, name, None)), name
    # Destructive operations must NOT be exposed.
    assert not any(n.startswith("delete") or "remove" in n for n in copilot._TOOL_NAME_SET)


async def test_dispatch_blocks_non_tool_attribute_names():
    from app.ai import copilot

    ctx = copilot._ToolContext(None, None, "u1")  # type: ignore[arg-type]
    for name in ("db", "cache", "user_id", "actions", "dispatch", "heavy_calls", "__init__"):
        out = await ctx.dispatch(name, {})
        assert out.get("error"), name


async def test_heavy_tool_cap_is_per_tool():
    from app.ai import copilot

    ctx = copilot._ToolContext(None, None, "u1")  # type: ignore[arg-type]
    ctx.heavy_calls = {"train_ml_model": copilot._HEAVY_LIMIT}
    out = await ctx.dispatch("train_ml_model", {"source_table": "sales", "target_column": "revenue"})
    assert "train_ml_model" in out.get("error", "")
    # Cap is PER TOOL: another heavy tool must get PAST the cap check — with a
    # None db it then dies INSIDE the handler (proof the cap didn't block it).
    import pytest

    with pytest.raises(AttributeError):
        await ctx.dispatch("generate_ba_artifact", {"framework": "swot"})


async def test_copilot_tools_share_endpoint_ip_buckets():
    # predict_ml through the copilot must consume the SAME per-IP bucket the
    # direct /automl endpoint uses — the agent path is not a limiter bypass.
    from app.ai import copilot
    from app.core import rate_limit

    rate_limit._HITS.clear()
    ip = "10.9.9.9"
    for _ in range(30):
        assert rate_limit.check_ip("automl_predict", ip, 30, 60)
    ctx = copilot._ToolContext(None, None, "u1", client_ip=ip)  # type: ignore[arg-type]
    out = await ctx.dispatch("predict_ml", {"model_id": "m", "row": {"x": 1}})
    assert "sürət həddi" in out.get("error", "")


async def test_simulate_metric_tree_pct_zero_is_applied_not_unknown(client: AsyncClient, auth: dict):
    root = (await client.post(
        "/api/v1/metric-tree/", json={"name": "Xalis", "operator": "add"}, headers=auth,
    )).json()
    await client.post(
        "/api/v1/metric-tree/",
        json={"name": "Satış", "parent_id": root["id"], "manual_value": 100},
        headers=auth,
    )
    from app.services import metric_tree_service
    from tests.conftest import _Session

    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    async with _Session() as session:
        out = await metric_tree_service.simulate(
            session, me["id"], [{"leaf_name": "satış", "pct": 0}]
        )
    assert out["applied"] == ["Satış"]  # explicit no-op is a MATCH, not unknown
    assert out["unknown_leaves"] == []


async def test_copilot_trains_ml_model_and_surfaces_chip(client: AsyncClient, auth: dict, monkeypatch):
    _queue_messages(monkeypatch, [
        _FakeMsg(tool_calls=[_FakeToolCall(
            "c1", "train_ml_model",
            '{"source_table": "sales", "target_column": "revenue", "name": "Copilot modeli"}',
        )]),
        _FakeMsg(content="Model hazırdır."),
    ])
    resp = await client.post(
        "/api/v1/copilot/chat",
        json={"message": "sales üçün revenue modeli öyrət", "history": [], "mode": "execute"},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    chips = resp.json()["actions"]
    ml = next(a for a in chips if a["type"] == "ml_model")
    assert ml["ml_model_id"]  # id surfaced through CopilotAction schema
    # The model really exists and is owner-scoped.
    listed = (await client.get("/api/v1/automl/models", headers=auth)).json()
    assert any(m["id"] == ml["ml_model_id"] for m in listed)


async def test_copilot_generates_ba_artifact_summary_without_mermaid(
    client: AsyncClient, auth: dict, monkeypatch
):
    _queue_messages(monkeypatch, [
        _FakeMsg(tool_calls=[_FakeToolCall(
            "c1", "generate_ba_artifact", '{"framework": "bcg", "title": "Portfel"}',
        )]),
        _FakeMsg(content="BCG hazırdır."),
    ])
    resp = await client.post(
        "/api/v1/copilot/chat",
        json={"message": "bcg matrisi qur", "history": [], "mode": "execute"},
        headers=auth,
    )
    assert resp.status_code == 200, resp.text
    chips = resp.json()["actions"]
    ba = next(a for a in chips if a["type"] == "ba_artifact")
    assert ba["ba_artifact_id"]


async def test_simulate_metric_tree_math_matches_combine(client: AsyncClient, auth: dict):
    # Build gəlir = qiymət × həcm via the API, then simulate +10% qiymət directly
    # against the tool method with a real session.
    root = (await client.post(
        "/api/v1/metric-tree/",
        json={"name": "Gəlir", "operator": "mul"},
        headers=auth,
    )).json()
    for name, val in (("Qiymət", 20), ("Həcm", 15)):
        r = await client.post(
            "/api/v1/metric-tree/",
            json={"name": name, "parent_id": root["id"], "manual_value": val},
            headers=auth,
        )
        assert r.status_code == 201, r.text

    from app.ai import copilot
    from tests.conftest import _Session

    me = (await client.get("/api/v1/auth/me", headers=auth)).json()
    async with _Session() as session:
        ctx = copilot._ToolContext(session, None, me["id"])  # type: ignore[arg-type]
        out = await ctx.dispatch(
            "simulate_metric_tree",
            {"changes": [{"leaf_name": "qiymət", "pct": 10}, {"leaf_name": "yox-belə", "pct": 5}]},
        )
    res = next(r for r in out["results"] if r["root"] == "Gəlir")
    assert res["baseline"] == 300.0
    assert res["simulated"] == 330.0  # 22 × 15 — parity with _combine
    assert out["applied"] == ["Qiymət"]  # case-insensitive name match
    assert out["unknown_leaves"] == ["yox-belə"]
