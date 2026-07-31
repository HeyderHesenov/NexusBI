#!/usr/bin/env python
"""Measure what NexusBI's AI features actually cost, one user action at a time.

Every tier quota in ``billing/tiers.py`` was derived from an estimate of $0.01
per completion that nobody had measured. This closes that: it drives the real
HTTP API, then reads ``ai_spend_daily`` around each phase and reports the cost
of one NL question, one free dashboard, one copilot run, and so on — plus the
quotas those numbers imply at the target margin.

It drives the API rather than calling the AI functions directly on purpose. The
cost of a call is mostly the cost of its prompt, and the prompt is assembled by
the request path — RAG context, schema linking, the language directive. Calling
``text2sql.generate_sql`` in isolation would measure a prompt production never
sends. Fanning out through the endpoint also measures what a *unit* costs, which
is the number the tiers are actually priced on.

Requirements, all checked before a cent is spent:
  * a backend running with a real AI_API_KEY,
  * AI_PRICE_* configured — unpriced calls record 0 and the report is all zeros,
  * PostgreSQL. SQLite drops ledger writes made during an open request
    transaction, which is every AI endpoint (see docs/deploy.md).

Usage (from backend/):
    python scripts/measure_ai_cost.py                 # ~115 calls, ~$1-3
    python scripts/measure_ai_cost.py --scale 0.5     # half of everything
    python scripts/measure_ai_cost.py --dry-run       # plan + preflight, no spend
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from dataclasses import dataclass, field

import httpx
from sqlalchemy import select

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.billing import tiers  # noqa: E402
from app.config import settings  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.models.ai_spend import AISpendDaily  # noqa: E402

BASE = os.environ.get("MEASURE_BASE_URL", "http://127.0.0.1:8000")
API = f"{BASE}/api/v1"
PASSWORD = "measure1234"

# Share of revenue that may go to the model. The spec's target is ~60% gross
# margin, so AI is the other 40%.
AI_SHARE_OF_REVENUE = 0.40

QUESTIONS = [
    "Aylıq gəlir necə dəyişib?",
    "Ən çox satılan beş məhsul hansıdır?",
    "Region üzrə satışların payı nədir?",
    "Müştəri sayı aydan-aya necə artıb?",
    "Orta çek məbləği nə qədərdir?",
    "Hansı kateqoriya ən çox gəlir gətirir?",
    "Son rübdə satışlar əvvəlki rüblə müqayisədə necədir?",
    "Ən yüksək gəlirli on müştəri kimdir?",
]

GOALS = [
    "Satış performansını izləmək üçün panel",
    "Müştəri davranışını göstərən panel",
]


@dataclass
class Phase:
    """One user-visible action, measured as a group."""

    key: str
    label: str
    runs: int = 0
    calls: int = 0
    embed_calls: int = 0
    micro_usd: int = 0
    embed_micro_usd: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def completions(self) -> int:
        return self.calls - self.embed_calls

    @property
    def completion_micro(self) -> int:
        return self.micro_usd - self.embed_micro_usd


async def ledger_snapshot() -> dict[tuple[str, str], tuple[int, int]]:
    """(feature, model) -> (calls, micro_usd) for today."""
    async with AsyncSessionLocal() as s:
        rows = (await s.execute(select(AISpendDaily))).scalars().all()
    return {(r.feature, r.model): (r.calls, r.micro_usd) for r in rows}


def ledger_delta(
    before: dict[tuple[str, str], tuple[int, int]],
    after: dict[tuple[str, str], tuple[int, int]],
) -> dict[tuple[str, str], tuple[int, int]]:
    out = {}
    for key, (calls, micro) in after.items():
        b_calls, b_micro = before.get(key, (0, 0))
        if calls - b_calls or micro - b_micro:
            out[key] = (calls - b_calls, micro - b_micro)
    return out


def _is_embedding(model: str) -> bool:
    """Embeddings are filed under EMBEDDING_MODEL, completions under AI_MODEL."""
    return bool(settings.EMBEDDING_MODEL) and model == settings.EMBEDDING_MODEL


class Runner:
    def __init__(self, client: httpx.AsyncClient, scale: float) -> None:
        self.client = client
        self.scale = scale
        self.phases: list[Phase] = []
        self.by_feature: dict[str, tuple[int, int]] = {}
        self.stopped_early = False

    def times(self, n: int) -> int:
        return max(1, round(n * self.scale))

    async def register(self, tier: str) -> dict[str, str]:
        email = f"measure-{tier}-{uuid.uuid4().hex[:8]}@nexusbi.io"
        resp = await self.client.post(
            f"{API}/auth/register",
            json={"email": email, "password": PASSWORD, "full_name": f"Measure {tier}"},
        )
        resp.raise_for_status()
        headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
        if tier != "free":
            up = await self.client.post(f"{API}/billing/upgrade", json={"tier": tier}, headers=headers)
            up.raise_for_status()
        return headers

    async def budget_ok(self) -> bool:
        resp = await self.client.get(f"{BASE}/ready")
        return resp.json()["components"]["ai"] == "ok"

    async def phase(self, key: str, label: str, body) -> Phase:
        """Run `body`, attributing every ledger row it moved to this phase."""
        ph = Phase(key=key, label=label)
        before = await ledger_snapshot()
        try:
            ph.runs = await body(ph)
        except Exception as exc:  # noqa: BLE001 — one broken feature must not end the run
            ph.errors.append(f"{type(exc).__name__}: {str(exc)[:160]}")
        # The ledger is written from its own session and committed there, so the
        # delta is visible the moment the request returns.
        delta = ledger_delta(before, await ledger_snapshot())
        for (feature, model), (calls, micro) in delta.items():
            ph.calls += calls
            ph.micro_usd += micro
            if _is_embedding(model):
                ph.embed_calls += calls
                ph.embed_micro_usd += micro
            f_calls, f_micro = self.by_feature.get(feature, (0, 0))
            self.by_feature[feature] = (f_calls + calls, f_micro + micro)
        self.phases.append(ph)
        print(
            f"  {label:<28} {ph.runs:>2} icra · {ph.completions:>3} completion · "
            f"${ph.micro_usd / 1e6:.4f}"
            + (f"  ⚠ {ph.errors[0]}" if ph.errors else "")
        )
        if not await self.budget_ok():
            print("\n  ⚠ Gündəlik büdcə tavanına dəyildi — ölçmə yarımçıq dayandırıldı.")
            self.stopped_early = True
        return ph


async def measure(runner: Runner) -> None:
    free = await runner.register("free")
    pro = await runner.register("pro")
    print(f"\nHesablar hazırdır (free + pro). Ölçmə başlayır — miqyas ×{runner.scale}\n")

    query_ids: list[str] = []

    async def ask(ph: Phase) -> int:
        n = runner.times(8)
        for q in QUESTIONS[:n]:
            resp = await runner.client.post(
                f"{API}/query/ask", json={"nl_query": q, "datasource_id": None}, headers=pro
            )
            resp.raise_for_status()
            qid = resp.json().get("query_log_id") or resp.json().get("id")
            if qid:
                query_ids.append(qid)
        return n

    async def dashboard(headers: dict, ph: Phase) -> int:
        n = runner.times(2)
        for goal in GOALS[:n]:
            resp = await runner.client.post(
                f"{API}/dashboard/generate",
                json={"goal": goal, "datasource_id": None},
                headers=headers,
            )
            resp.raise_for_status()
        return n

    async def copilot(ph: Phase) -> int:
        n = runner.times(3)
        for i in range(n):
            resp = await runner.client.post(
                f"{API}/copilot/chat",
                json={"message": QUESTIONS[i % len(QUESTIONS)], "mode": "execute"},
                headers=pro,
            )
            resp.raise_for_status()
        return n

    async def ba(ph: Phase) -> int:
        n = runner.times(2)
        for framework in ("swot", "porter")[:n]:
            resp = await runner.client.post(
                f"{API}/ba/generate",
                json={"framework": framework, "title": "Ölçmə", "context": "Satış biznesi"},
                headers=pro,
            )
            resp.raise_for_status()
        return n

    async def requirements(ph: Phase) -> int:
        n = runner.times(2)
        for i in range(n):
            resp = await runner.client.post(
                f"{API}/requirements/extract",
                json={
                    "name": f"Tələb {i}",
                    "text": (
                        "Aylıq gəliri, müştəri sayını və orta çeki izləmək istəyirik. "
                        "Region üzrə bölgü və rüblük müqayisə də lazımdır."
                    ),
                },
                headers=pro,
            )
            resp.raise_for_status()
        return n

    async def analysis(ph: Phase) -> int:
        """Forecast / anomalies / root-cause, over the queries ask() produced."""
        if not query_ids:
            raise RuntimeError("ask mərhələsi query_log_id qaytarmadı")
        n = runner.times(2)
        done = 0
        for qid in query_ids[:n]:
            for path, payload in (
                (f"{API}/query/{qid}/forecast", {"periods": 6}),
                (f"{API}/query/{qid}/anomalies", None),
                (f"{API}/query/{qid}/root-cause", None),
            ):
                resp = await runner.client.post(path, json=payload, headers=pro)
                if resp.status_code < 400:
                    done += 1
        return done

    await runner.phase("ask", "bir NL sual", ask)
    if runner.stopped_early:
        return
    await runner.phase("dash_free", "bir pulsuz dashboard", lambda ph: dashboard(free, ph))
    if runner.stopped_early:
        return
    await runner.phase("dash_pro", "bir ödənişli dashboard", lambda ph: dashboard(pro, ph))
    if runner.stopped_early:
        return
    await runner.phase("copilot", "bir copilot icrası", copilot)
    if runner.stopped_early:
        return
    await runner.phase("ba", "bir BA artefaktı", ba)
    if runner.stopped_early:
        return
    await runner.phase("requirements", "bir tələb sənədi", requirements)
    if runner.stopped_early:
        return
    await runner.phase("analysis", "bir analiz çağırışı", analysis)


def report(runner: Runner) -> None:
    print("\n" + "═" * 78)
    print("İSTİFADƏÇİ HƏRƏKƏTİ ÜZRƏ")
    print("═" * 78)
    print(f"{'hərəkət':<28}{'icra':>5}{'compl.':>8}{'embed':>7}{'cəmi $':>11}{'$/hərəkət':>12}")
    for ph in runner.phases:
        per = ph.micro_usd / ph.runs / 1e6 if ph.runs else 0.0
        print(
            f"{ph.label:<28}{ph.runs:>5}{ph.completions:>8}{ph.embed_calls:>7}"
            f"{ph.micro_usd / 1e6:>11.4f}{per:>12.4f}"
        )

    print("\n" + "═" * 78)
    print("FEATURE ÜZRƏ")
    print("═" * 78)
    print(f"{'feature':<24}{'çağırış':>9}{'cəmi $':>11}{'$/çağırış':>12}")
    for feature, (calls, micro) in sorted(
        runner.by_feature.items(), key=lambda kv: -kv[1][1]
    ):
        per = micro / calls / 1e6 if calls else 0.0
        print(f"{feature:<24}{calls:>9}{micro / 1e6:>11.4f}{per:>12.5f}")

    total_completions = sum(p.completions for p in runner.phases)
    total_completion_micro = sum(p.completion_micro for p in runner.phases)
    total_micro = sum(p.micro_usd for p in runner.phases)
    if not total_completions:
        print("\n⚠ Heç bir completion qeyd olunmadı — qiymətlər və ya uçot işləmir.")
        return

    per_unit = total_completion_micro / total_completions / 1e6
    print("\n" + "═" * 78)
    print("NƏTİCƏ")
    print("═" * 78)
    print(f"Ölçmənin özü xərclədi:        ${total_micro / 1e6:.4f}")
    print(f"Completion (kvota vahidi):    {total_completions}")
    print(f"BİR VAHİDİN REAL QİYMƏTİ:     ${per_unit:.5f}   (təxmin $0.01000 idi)")
    ratio = per_unit / 0.01
    print(f"Təxminə nisbətdə:             ×{ratio:.2f}")

    print(f"\nAI xərci gəlirin {AI_SHARE_OF_REVENUE:.0%}-i olsun deyə tövsiyə olunan kvotalar:")
    print(f"{'tarif':<8}{'qiymət':>8}{'AI büdcəsi':>12}{'indi':>8}{'tövsiyə':>10}   qeyd")
    for key in tiers.PURCHASABLE:
        tier = tiers.get_tier(key)
        if tier.price_usd == 0:
            # Free has no revenue, so there is no margin to solve for; its quota
            # is a marketing decision and the useful number is what it costs.
            cost_now = tier.monthly_quota * per_unit
            print(
                f"{tier.name:<8}{'$0':>8}{'—':>12}{tier.monthly_quota:>8}{'—':>10}"
                f"   bir pulsuz istifadəçi ≈ ${cost_now:.2f}/ay"
            )
            continue
        budget = tier.price_usd * AI_SHARE_OF_REVENUE
        recommended = int(round(budget / per_unit / 50) * 50)
        print(
            f"{tier.name:<8}{'$' + str(tier.price_usd):>8}{'$' + f'{budget:.2f}':>12}"
            f"{tier.monthly_quota:>8}{recommended:>10}"
            f"   ×{recommended / tier.monthly_quota:.1f}"
        )
    if runner.stopped_early:
        print("\n⚠ YARIMÇIQ ÖLÇMƏ — büdcə tavanı dayandırdı, rəqəmlər natamamdır.")


async def preflight() -> bool:
    ok = True
    if not settings.DATABASE_URL.startswith("postgresql"):
        print(f"✗ DATABASE_URL Postgres deyil ({settings.DATABASE_URL.split('://')[0]}). "
              "SQLite açıq tranzaksiya altında uçot yazısını itirir — ölçmə sıfır verər.")
        ok = False
    if not (settings.AI_PRICE_INPUT_USD_PER_1M or settings.AI_PRICE_OUTPUT_USD_PER_1M):
        print("✗ AI_PRICE_* qoyulmayıb — hər çağırış 0 micro-USD yazılar.")
        ok = False
    if not settings.AI_API_KEY or not settings.AI_MODEL:
        print("✗ AI_API_KEY / AI_MODEL yoxdur — determinist yol ölçüləcək, model yox.")
        ok = False
    async with httpx.AsyncClient(timeout=10) as c:
        try:
            ai = (await c.get(f"{BASE}/ready")).json()["components"]["ai"]
        except Exception as exc:  # noqa: BLE001
            print(f"✗ Backend {BASE} cavab vermir: {type(exc).__name__}")
            return False
    if ai != "ok":
        print(f"✗ /ready → ai: {ai}")
        ok = False
    if ok:
        print(f"✓ Postgres · qiymətlər qoyulub · {settings.AI_MODEL} · büdcə açıqdır")
    return ok


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scale", type=float, default=1.0, help="təkrar sayını miqyasla")
    parser.add_argument("--dry-run", action="store_true", help="yalnız ön yoxlama")
    args = parser.parse_args()

    print("NexusBI — AI xərcinin ölçülməsi\n" + "─" * 78)
    if not await preflight():
        return 1
    if args.dry_run:
        print("\n--dry-run: heç nə xərclənmədi.")
        return 0

    # Long timeout: a dashboard generation is ~19 sequential model calls.
    async with httpx.AsyncClient(timeout=300) as client:
        runner = Runner(client, args.scale)
        await measure(runner)
        report(runner)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
