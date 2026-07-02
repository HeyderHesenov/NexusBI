"""BA Framework Studio: generators, mermaid sanitizer, deterministic BCG, CRUD."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from httpx import AsyncClient

from app.ai import ba_frameworks
from app.core.exceptions import AIGenerationError

# ─── Mermaid sanitizer (fail-closed) ───


def test_sanitizer_accepts_plain_flowchart():
    code = "flowchart TD\n  A([Başla]) --> B[Sifariş]\n  B --> C{Stokda?}"
    assert ba_frameworks.sanitize_mermaid(code) == code


def test_sanitizer_strips_fences():
    fenced = "```mermaid\nflowchart TD\n  A --> B\n```"
    assert ba_frameworks.sanitize_mermaid(fenced) == "flowchart TD\n  A --> B"


def test_sanitizer_rejects_dangerous_payloads():
    bad = [
        "graph TD\n  A --> B",  # wrong header
        "flowchart TD\n  click A callback",  # interactivity
        "flowchart TD\n  %%{init: {'theme':'x'}}%%",  # directive
        "flowchart TD\n  A[<script>alert(1)</script>]",  # markup
        "flowchart TD\n  A[<svg onload=alert(1)>]",  # markup w/o 'script'
        "flowchart TD\n  A[<iframe srcdoc=x>]",
        "flowchart TD\n  A --> B\n  style A fill:#f00",  # styling hook
        "flowchart TD\n  A[x]:::c",  # class shorthand
        "flowchart TD\n  A[x]\n  classDef c fill:#f00",
        "flowchart TD\n  A[javascript:alert(1)]",
        "flowchart TD\n" + "  A --> B\n" * 600,  # over length cap
        "",
    ]
    for code in bad:
        assert ba_frameworks.sanitize_mermaid(code) is None, code


def test_sanitizer_allows_keyword_words_inside_labels():
    # "class"/"style" as ordinary label words must NOT be rejected — only
    # statement-position keywords are dangerous.
    code = "flowchart TD\n  A[Assign class to student] --> B[Review style guide]"
    assert ba_frameworks.sanitize_mermaid(code) == code


# ─── Deterministic BCG core ───


def test_bcg_quadrants_deterministic():
    core = ba_frameworks.compute_bcg()
    by_label = {i["label"]: i for i in core["items"]}
    # Demo seed: Books/Sports grow H2>H1 with high share; Home/Clothing shrink;
    # Electronics grows slightly on the lowest share.
    assert by_label["Books"]["quadrant"] == "star"
    assert by_label["Sports"]["quadrant"] == "star"
    assert by_label["Home"]["quadrant"] == "cash_cow"
    assert by_label["Clothing"]["quadrant"] == "dog"
    assert by_label["Electronics"]["quadrant"] == "question"
    assert abs(sum(i["share_pct"] for i in core["items"]) - 100) < 1


def test_bcg_h2_only_category_is_high_growth(monkeypatch):
    # A category launched in H2 (h1=0) is the fastest grower, not a flat one.
    rows = [
        {"category": "Old", "h1": 100.0, "h2": 90.0, "total": 190.0},
        {"category": "New", "h1": 0.0, "h2": 50.0, "total": 50.0},
    ]
    monkeypatch.setattr(ba_frameworks, "execute_demo_snapshot", lambda sqls: [rows])
    by = {i["label"]: i for i in ba_frameworks.compute_bcg()["items"]}
    assert by["New"]["growth_pct"] == 100.0
    assert by["New"]["quadrant"] == "question"
    assert by["Old"]["quadrant"] == "cash_cow"


async def test_bcg_advice_falls_back_offline():
    with patch.object(ba_frameworks, "chat_json", AsyncMock(side_effect=AIGenerationError("no key"))):
        out = await ba_frameworks.bcg("portfel")
    assert out["items"] and out["advice"]
    assert "Books" in out["advice"] or "Ulduz" in out["advice"]


# ─── Fallbacks on AI failure ───


async def test_swot_rule_based_buckets_by_keywords():
    ctx = (
        "Güclü mühəndis komandamız var.\n"
        "Zəif marketinq büdcəsi problemdir.\n"
        "Yeni bazara çıxış imkanı görünür.\n"
        "Rəqiblərin qiymət təzyiqi riski artır."
    )
    with patch.object(ba_frameworks, "chat_json", AsyncMock(side_effect=AIGenerationError("x"))):
        out = await ba_frameworks.swot(ctx)
    assert any("komanda" in s for s in out["strengths"])
    assert any("marketinq" in s for s in out["weaknesses"])
    assert any("bazar" in s for s in out["opportunities"])
    assert any("Rəqib" in s for s in out["threats"])


async def test_porter_fallback_returns_all_five_forces():
    with patch.object(ba_frameworks, "chat_json", AsyncMock(side_effect=AIGenerationError("x"))):
        out = await ba_frameworks.porter("kontekst")
    assert [f["key"] for f in out["forces"]] == list(ba_frameworks.PORTER_KEYS)
    assert all(f["level"] == "medium" for f in out["forces"])


async def test_porter_ai_bad_level_coerced_and_keys_fixed():
    fake = {
        "forces": [
            {"key": "rivalry", "level": "EXTREME", "rationale": "r"},
            {"key": "invented_force", "level": "high", "rationale": "x"},
        ],
        "advice": "a",
    }
    with patch.object(ba_frameworks, "chat_json", AsyncMock(return_value=fake)):
        out = await ba_frameworks.porter("kontekst")
    keys = [f["key"] for f in out["forces"]]
    assert keys == list(ba_frameworks.PORTER_KEYS)  # invented force dropped, none missing
    assert out["forces"][0]["level"] == "medium"  # bad level coerced


async def test_bpmn_rejected_ai_output_falls_back_to_linear_flow():
    fake = {"mermaid": "flowchart TD\n  click A javascript:alert(1)", "summary": "s"}
    with patch.object(ba_frameworks, "chat_json", AsyncMock(return_value=fake)):
        out = await ba_frameworks.bpmn("Sifariş qəbul olunur. Anbar yoxlanılır. Məhsul göndərilir.")
    assert out["mermaid"].startswith("flowchart TD")
    assert ba_frameworks.sanitize_mermaid(out["mermaid"]) is not None
    assert "N0" in out["mermaid"] and "-->" in out["mermaid"]


# ─── API CRUD + ownership ───


async def test_ba_generate_list_get_delete(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/ba/generate",
        json={"framework": "bcg", "title": "Portfel", "context": "kateqoriya portfeli"},
        headers=auth,
    )
    assert resp.status_code == 201, resp.text
    art = resp.json()
    assert art["framework"] == "bcg" and art["content"]["items"]

    listed = (await client.get("/api/v1/ba", headers=auth)).json()
    assert any(a["id"] == art["id"] for a in listed)

    got = await client.get(f"/api/v1/ba/{art['id']}", headers=auth)
    assert got.status_code == 200 and got.json()["title"] == "Portfel"

    assert (await client.delete(f"/api/v1/ba/{art['id']}", headers=auth)).status_code == 204
    assert (await client.get(f"/api/v1/ba/{art['id']}", headers=auth)).status_code == 404


async def test_ba_cross_user_isolated(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/ba/generate",
        json={"framework": "swot", "title": "Gizli", "context": "güclü komanda"},
        headers=auth,
    )
    art_id = resp.json()["id"]
    reg = await client.post(
        "/api/v1/auth/register",
        json={"email": "ba-mate@nexusbi.io", "password": "parol1234", "full_name": "Mate"},
    )
    auth2 = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    assert (await client.get(f"/api/v1/ba/{art_id}", headers=auth2)).status_code == 404
    assert (await client.delete(f"/api/v1/ba/{art_id}", headers=auth2)).status_code == 404


async def test_ba_generate_rejects_unknown_framework(client: AsyncClient, auth: dict):
    resp = await client.post(
        "/api/v1/ba/generate",
        json={"framework": "pestel", "context": "x"},
        headers=auth,
    )
    assert resp.status_code == 422
