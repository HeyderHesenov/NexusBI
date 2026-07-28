"""BA Framework Studio: generators, mermaid sanitizer, deterministic BCG, CRUD."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from httpx import AsyncClient

from app.ai import ba_bcg, ba_evidence, ba_frameworks
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


def test_bcg_h2_only_category_is_high_growth():
    # A line that launched in the second half (h1=0) is the fastest grower there
    # is, not a flat one. The core now takes a dim × period cross-tab.
    rows = [
        {"d": "Old", "p": "2024-01", "m": 100.0},
        {"d": "Old", "p": "2024-02", "m": 90.0},
        {"d": "New", "p": "2024-02", "m": 50.0},
    ]
    by = {i["label"]: i for i in ba_bcg.bcg_core_from_rows(rows, "d", "p", "m")["items"]}
    assert by["New"]["growth_pct"] == 100.0
    assert by["New"]["quadrant"] == "question"
    assert by["Old"]["quadrant"] == "cash_cow"


def test_bcg_rank_split_matches_calendar_halves():
    # The split is by RANK (sorted period keys cut at len//2), not by calendar
    # month arithmetic — that's what keeps it dialect-free. On the demo's 12
    # month-keys the two must coincide, which is what pins the quadrants above.
    rows = [
        {"d": "A", "p": f"2024-{m:02d}", "m": 10.0 if m <= 6 else 20.0} for m in range(1, 13)
    ]
    item = ba_bcg.bcg_core_from_rows(rows, "d", "p", "m")["items"][0]
    assert item["growth_pct"] == 100.0  # H2 (6×20) vs H1 (6×10)


def test_bcg_single_period_is_flat_not_infinite_growth():
    rows = [{"d": "A", "p": "2024-01", "m": 10.0}, {"d": "B", "p": "2024-01", "m": 5.0}]
    items = ba_bcg.bcg_core_from_rows(rows, "d", "p", "m")["items"]
    assert all(i["growth_pct"] == 0.0 for i in items)


def test_bcg_in_list_escapes_quotes():
    # Dimension values are DATA out of the user's table — they must go through a
    # literal builder, never an f-string.
    assert ba_bcg._in_list(["O'Brien"], "postgresql") == "'O''Brien'"
    assert "DROP" in ba_bcg._in_list(["x'; DROP TABLE t--"], "sqlite")
    assert ba_bcg._in_list(["x'; DROP TABLE t--"], "sqlite").count("'") == 4


async def test_bcg_advice_falls_back_offline():
    core = ba_bcg.compute_bcg()
    facts = ba_evidence.facts_from_bcg(core)
    with patch.object(ba_frameworks, "chat_json", AsyncMock(side_effect=AIGenerationError("no key"))):
        out = await ba_frameworks.bcg("portfel", facts, core)
    assert out["items"] and out["advice"]
    assert "Books" in out["advice"] or "Ulduz" in out["advice"]
    # The offline path must still hand the user something to act on.
    assert out["actions"] and all(1 <= a["impact"] <= 5 for a in out["actions"])


# ─── Fallbacks on AI failure ───


async def test_swot_rule_based_buckets_by_keywords():
    ctx = (
        "Güclü mühəndis komandamız var.\n"
        "Zəif marketinq büdcəsi problemdir.\n"
        "Yeni bazara çıxış imkanı görünür.\n"
        "Rəqiblərin qiymət təzyiqi riski artır."
    )
    with patch.object(ba_frameworks, "chat_json", AsyncMock(side_effect=AIGenerationError("x"))):
        out = await ba_frameworks.swot(ctx, [])

    def texts(bucket: str) -> list[str]:
        return [i["text"] for i in out[bucket]]

    assert any("komanda" in s for s in texts("strengths"))
    assert any("marketinq" in s for s in texts("weaknesses"))
    assert any("bazar" in s for s in texts("opportunities"))
    assert any("Rəqib" in s for s in texts("threats"))
    # No facts were supplied, so nothing may claim to be data-backed.
    assert all(
        not i["derived"] and i["evidence"] == []
        for b in ("strengths", "weaknesses", "opportunities", "threats")
        for i in out[b]
    )


async def test_porter_fallback_returns_all_five_forces():
    with patch.object(ba_frameworks, "chat_json", AsyncMock(side_effect=AIGenerationError("x"))):
        out = await ba_frameworks.porter("kontekst", [])
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
        out = await ba_frameworks.porter("kontekst", [])
    keys = [f["key"] for f in out["forces"]]
    assert keys == list(ba_frameworks.PORTER_KEYS)  # invented force dropped, none missing
    assert out["forces"][0]["level"] == "medium"  # bad level coerced


async def test_bpmn_rejected_ai_output_falls_back_to_linear_flow():
    fake = {"mermaid": "flowchart TD\n  click A javascript:alert(1)", "summary": "s"}
    with patch.object(ba_frameworks, "chat_json", AsyncMock(return_value=fake)):
        out = await ba_frameworks.bpmn(
            "Sifariş qəbul olunur. Anbar yoxlanılır. Məhsul göndərilir.", []
        )
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
