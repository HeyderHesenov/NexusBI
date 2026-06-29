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

    async def fake_chat_tools(msgs, tools, *, temperature=0.0):
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
