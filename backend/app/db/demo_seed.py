"""Seed rich demo content so every page looks alive on a fresh demo login.

DEMO_MODE only. The bare ``_seed_demo_account`` in ``main`` creates just the login
row, which leaves Dashboards / History / Decisions / Metrics / Knowledge-Graph /
Notifications / Chat all showing empty states — the biggest live-demo risk. This
module populates each of those surfaces once, idempotently.

Design notes:
  * Idempotent — a sentinel (demo user already has a dashboard) short-circuits on
    every restart, so the file-based SQLite pays this cost only on first boot.
  * Resilient — each phase runs in its OWN session with its own try/except, so a
    failure never poisons the next phase or blocks startup.
  * Genuine artefacts — history and dashboards go through the REAL query pipeline
    (``process_nl_query`` / ``assemble_dashboard``), so charts/insights/trust
    signals match exactly what the live product produces. Questions are
    schema-shaped so they resolve under BOTH the AI engine and the offline
    rule-based fallback (see ``app.ai.rule_based_sql``).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.config import settings
from app.core.logging import get_logger

log = get_logger()

# Two demo boards — each question resolves against the demo ``sales`` / ``customers``
# / ``events`` tables under both AI and rule-based generation.
_BOARDS: list[tuple[str, str, list[str]]] = [
    (
        "İcra İcmalı",
        "Əsas biznes göstəriciləri bir baxışda.",
        ["kateqoriya üzrə gəlir", "ay üzrə gəlir", "region üzrə gəlir"],
    ),
    (
        "Satış Təhlili",
        "Məhsul, ölkə və konversiya funnel-i üzrə dərinləşmə.",
        ["ən çox gəlir gətirən 5 məhsul", "ölkə üzrə müştəri sayı", "mərhələ üzrə funnel"],
    ),
]

# Extra standalone questions so History looks lived-in beyond the board widgets.
_EXTRA_HISTORY: list[str] = ["ümumi gəlir", "ən çox xərcləyən 10 müştəri"]


async def seed_demo_content() -> None:
    """Populate the demo account with content across every page (idempotent)."""
    if not settings.DEMO_MODE:
        return

    from app.db.session import AsyncSessionLocal
    from app.models.dashboard import Dashboard
    from app.models.user import User
    from app.services.cache_service import build_cache_service

    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.email == "demo@nexusbi.io"))
        ).scalar_one_or_none()
        if user is None:
            return
        # Sentinel: a dashboard means we already seeded — don't duplicate on restart.
        already = (
            await db.execute(
                select(Dashboard.id).where(Dashboard.user_id == user.id).limit(1)
            )
        ).first()
        if already is not None:
            return
        user_id, user_name = user.id, (user.full_name or "Demo")

    cache = await build_cache_service()

    # Each phase gets a fresh session so one failure can't poison the rest.
    phases = [
        ("dashboards", _seed_dashboards_and_history),
        ("metrics", _seed_metrics),
        ("decisions", _seed_decisions),
        ("notifications", _seed_notifications),
        ("chat", _seed_chat),
        ("automl", _seed_automl),
        ("ba", _seed_ba),
    ]
    for name, fn in phases:
        try:
            async with AsyncSessionLocal() as db:
                await fn(db, cache, user_id, user_name)
                await db.commit()
        except Exception as exc:  # noqa: BLE001 — never block startup on seeding
            log.warning("demo_seed_phase_failed", phase=name, error=str(exc)[:200])
    log.info("demo_content_seeded")


async def _seed_dashboards_and_history(db, cache, user_id, user_name) -> None:
    """Build the two demo boards (which also fills History), plus extra history."""
    from app.services import dashboard_service, query_service

    for name, desc, questions in _BOARDS:
        try:
            await dashboard_service.assemble_dashboard(
                db, cache, user_id, name, desc, questions, None
            )
            await db.commit()
        except Exception as exc:  # noqa: BLE001 — one weak board shouldn't sink the other
            await db.rollback()
            log.warning("demo_seed_board_failed", board=name, error=str(exc)[:200])

    for question in _EXTRA_HISTORY:
        try:
            await query_service.process_nl_query(question, None, user_id, db, cache)
            await db.commit()
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            log.warning("demo_seed_history_failed", question=question, error=str(exc)[:200])


async def _seed_metrics(db, cache, user_id, user_name) -> None:
    """Semantic-layer metrics — also give the Knowledge Graph its nodes."""
    from app.schemas.metric import MetricCreate
    from app.services import metric_service

    specs = [
        ("Gəlir", "SUM(revenue)", "Ümumi satış gəliri", "satış,turnover,gelir", True),
        ("Sifariş sayı", "COUNT(*)", "Ümumi satış əməliyyatları", "orders,satış sayı", True),
        ("Orta çek (AOV)", "SUM(revenue) / COUNT(*)", "Orta sifariş dəyəri", "aov,orta çek", False),
        ("Müştəri sayı", "COUNT(DISTINCT customer_id)", "Unikal müştərilər", "customers,müştəri", False),
    ]
    for mname, expr, mdesc, syn, verified in specs:
        metric = await metric_service.create(
            db,
            user_id,
            MetricCreate(
                name=mname, expression=expr, description=mdesc, synonyms=syn, datasource_id=None
            ),
        )
        if verified:
            await metric_service.set_verified(db, user_id, metric.id, True, "Demo")


async def _seed_decisions(db, cache, user_id, user_name) -> None:
    """Decision Intelligence Loop entries with a baseline→realized trajectory."""
    from app.models.decision import Decision, DecisionMeasurement

    now = datetime.now(timezone.utc)

    async def _decision(
        title, insight, action, status, impact, predicted, baseline, realized, points
    ) -> None:
        d = Decision(
            user_id=user_id,
            title=title,
            insight=insight,
            action=action,
            status=status,
            metric_column="total_revenue",
            datasource_id=None,
            predicted_value=predicted,
            predicted_direction="increase",
            baseline_value=baseline,
            baseline_at=now - timedelta(days=30),
            realized_value=realized,
            realized_at=now,
            measure_cadence="off",
            impact_status=impact,
        )
        db.add(d)
        await db.flush()  # populate d.id for the measurement FKs
        db.add_all(
            [
                DecisionMeasurement(decision_id=d.id, value=val, measured_at=now - timedelta(days=days))
                for days, val in points
            ]
        )

    await _decision(
        "West bölgəsində reklam büdcəsini yenidən bölüşdür",
        "West bölgəsi ROI baxımından ən zəif performans göstərir.",
        "Büdcənin 20%-ni West-dən North-a keçirdik.",
        "done",
        "achieved",
        52000.0,
        45000.0,
        53500.0,
        [(30, 45000.0), (20, 47800.0), (10, 50600.0), (0, 53500.0)],
    )
    await _decision(
        "Elektronika kateqoriyasında hədəflənmiş endirim",
        "Elektronika ən yüksək tələbatlı kateqoriyadır — elastiklik test edilir.",
        "Top-5 elektronika məhsuluna 10% endirim tətbiq etdik.",
        "in_progress",
        "on_track",
        38000.0,
        31000.0,
        35200.0,
        [(30, 31000.0), (20, 32400.0), (10, 34100.0), (0, 35200.0)],
    )


async def _seed_notifications(db, cache, user_id, user_name) -> None:
    """A few notifications + one AI morning-brief digest."""
    from app.core.notification_types import NotificationCategory
    from app.services import digest_service, notify_service

    items = [
        ("Gəlir artımı", "Bu ay gəlir keçən aya görə 12% artdı.", NotificationCategory.INSIGHT),
        ("KPI hədəfi yaxınlaşır", "Q3 gəlir hədəfinin 87%-nə çatdınız.", NotificationCategory.KPI_ALERT),
        (
            "Qərar nəticəsi",
            "«West büdcə yenidən bölüşdürülməsi» qərarı hədəfə çatdı.",
            NotificationCategory.DECISION,
        ),
    ]
    for title, body, category in items:
        await notify_service.create(db, user_id, title, body, category)

    # Digest scans recent query_logs (seeded above) and produces one brief.
    await digest_service.build_digest(db, user_id)


async def _seed_chat(db, cache, user_id, user_name) -> None:
    """A default workspace + channel + a short conversation, so Chat isn't empty."""
    import secrets

    from app.core.security import hash_password
    from app.models.user import User
    from app.services import chat_service, workspace_service

    # A teammate so the room reads like a real conversation (not a monologue).
    teammate = (
        await db.execute(select(User).where(User.email == "aysel@nexusbi.io"))
    ).scalar_one_or_none()
    if teammate is None:
        teammate = User(
            email="aysel@nexusbi.io",
            hashed_password=hash_password(secrets.token_urlsafe(24)),
            full_name="Aysel Məmmədova",
            subscription_tier="free",
        )
        db.add(teammate)
        await db.flush()
    teammate_id, teammate_name = teammate.id, (teammate.full_name or "Aysel")

    ws = await workspace_service.create(db, user_id, "NexusBI Komandası")
    await workspace_service.add_member(db, ws.id, user_id, "aysel@nexusbi.io", "editor")
    channel = await chat_service.create_channel(db, ws.id, user_id, "ümumi")
    room = chat_service.channel_room(ws.id, channel.id)

    conversation = [
        (teammate_id, teammate_name, "Salam komanda 👋 Bu ay satış hesabatını hazırladım."),
        (user_id, user_name, "Əla! Kateqoriya üzrə gəlirə baxdım — Elektronika liderdir."),
        (teammate_id, teammate_name, "West bölgəsi bir az geridədir, gəlin ora fokuslanaq."),
        (user_id, user_name, "Razıyam — qərar kartı yaratdım, nəticəni izləyirik."),
    ]
    for author_id, author_name, content in conversation:
        await chat_service.post_message(db, room, author_id, author_name, content)


async def _seed_automl(db, cache, user_id, user_name) -> None:
    """One trained AutoML model so the AutoML page has a leaderboard (best-effort)."""
    from app.services import automl_service

    await automl_service.train(db, cache, user_id, "Gəlir proqnozu", "sales", None, "revenue")


# BA Studio was the last page that still opened empty on a demo login — the runbook
# used to tell the presenter to hand-build an artifact before showing it.
_BA_CONTEXT = (
    "Güclü mühəndis komandamız və sadiq müştəri bazamız var.\n"
    "Zəif marketinq büdcəsi böyümə sürətini məhdudlaşdırır.\n"
    "Yeni regionlara çıxış imkanı görünür.\n"
    "Rəqiblərin qiymət təzyiqi riski artır."
)


async def _seed_ba(db, cache, user_id, user_name) -> None:
    """A SWOT and a BCG artifact through the REAL generate pipeline.

    Offline this takes the rule-based route, which still yields deterministic
    facts, rule-derived evidence and prioritised actions — so the seeded artifacts
    show the same evidence/judgement split a live one does.
    """
    from app.services import ba_service

    for framework, title, context in (
        ("swot", "Şirkət SWOT-u", _BA_CONTEXT),
        ("bcg", "Kateqoriya portfeli", "kateqoriya portfelini qiymətləndir"),
    ):
        try:
            await ba_service.generate(db, cache, user_id, framework, title, context)
            await db.commit()
        except Exception as exc:  # noqa: BLE001 — one weak artifact shouldn't sink the other
            await db.rollback()
            log.warning("demo_seed_ba_failed", framework=framework, error=str(exc)[:200])
