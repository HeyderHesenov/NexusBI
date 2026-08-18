"""Structural invariants — the ones a normal test cannot express.

Every check here exists because a specific bug got in, and a behavioural test
would only have caught that one instance of it. These fail on the *shape* of new
code instead, so the same mistake cannot be made a second time in a new place.
"""
from __future__ import annotations

import ast
from pathlib import Path

import pytest

_APP = Path(__file__).resolve().parents[1] / "app"


def _python_files() -> list[Path]:
    return sorted(p for p in _APP.rglob("*.py") if "migrations" not in p.parts)


def _module_name(path: Path) -> str:
    return "app/" + str(path.relative_to(_APP))


# ─── 1. One execution chokepoint ───
#
# `query_service._guarded_execute` is where the table allowlist and per-viewer
# RLS are applied. `datasource_service.execute_select` re-validates SELECT-only
# and nothing else, so any module that calls it directly runs SQL with neither
# guard. Data-prep and profiling both did, and both leaked every row past a
# member's RLS rules. Anything else that needs to read a live source goes through
# `query_service.guarded_read`.
_EXECUTE_SELECT_CALLERS = {"app/services/query_service.py"}


def test_execute_select_is_only_called_from_query_service():
    offenders = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if name == "execute_select" and _module_name(path) not in _EXECUTE_SELECT_CALLERS:
                offenders.append(f"{_module_name(path)}:{node.lineno}")

    assert not offenders, (
        "These call datasource_service.execute_select directly, bypassing the table "
        "allowlist and per-viewer RLS. Route the read through "
        f"query_service.guarded_read instead: {offenders}"
    )


# ─── 2. Rate-limit ratchet on mutating routes ───
#
# A frozen list of the routes that have neither an IP rate limit nor an AI quota
# today. It is a ratchet, not an endorsement: most of these are cheap
# authenticated CRUD that may never need one, but a NEW unlimited route must be a
# deliberate edit to this list rather than an oversight. Removing an entry when a
# route gains a limit is the point -- the list should only ever shrink.
_UNLIMITED_MUTATING_ROUTES = frozenset({
    "POST /api/v1/auth/google",
    "POST /api/v1/billing/checkout",
    # Stripe delivers from a shared pool of IPs and batches invoices at the
    # top of a billing cycle, so an IP limit here drops entitlement changes
    # for unrelated customers. The signature is the gate (billing.webhook),
    # and an unsigned request never reaches a write.
    "POST /api/v1/billing/webhook",
    "POST /api/v1/billing/upgrade",
    "PUT /api/v1/brand",
    "POST /api/v1/chat/ai/approve",
    "POST /api/v1/chat/ai/cancel",
    "POST /api/v1/chat/read",
    "POST /api/v1/chat/ticket",
    "POST /api/v1/chat/user-ticket",
    "POST /api/v1/contracts/",
    "POST /api/v1/contracts/{contract_id}/run",
    "POST /api/v1/copilot/chat",
    "POST /api/v1/dashboard/",
    "PUT /api/v1/dashboard/{dashboard_id}",
    "PATCH /api/v1/dashboard/{dashboard_id}/embed",
    "PATCH /api/v1/dashboard/{dashboard_id}/filter",
    "PATCH /api/v1/dashboard/{dashboard_id}/live",
    "POST /api/v1/dashboard/{dashboard_id}/refresh-all",
    "POST /api/v1/dashboard/{dashboard_id}/share",
    "POST /api/v1/dashboard/{dashboard_id}/snapshots",
    "POST /api/v1/dashboard/{dashboard_id}/widget",
    "POST /api/v1/dashboard/{dashboard_id}/widget/{widget_id}/refresh",
    "POST /api/v1/datasource/",
    "POST /api/v1/datasource/connect-powerbi",
    "POST /api/v1/datasource/upload",
    "PATCH /api/v1/datasource/{datasource_id}/data",
    "POST /api/v1/datasource/{datasource_id}/explore",
    "POST /api/v1/datasource/{datasource_id}/rls",
    "PATCH /api/v1/datasource/{datasource_id}/sla",
    "POST /api/v1/datasource/{datasource_id}/test",
    "POST /api/v1/decisions/",
    "PUT /api/v1/decisions/{decision_id}",
    "POST /api/v1/graph/views",
    "PATCH /api/v1/graph/views/{view_id}",
    "POST /api/v1/integrations",
    "POST /api/v1/integrations/{channel_id}/test",
    "POST /api/v1/kpi-targets",
    "PATCH /api/v1/kpi-targets/{target_id}",
    "POST /api/v1/metric-tree/",
    "PATCH /api/v1/metric-tree/{node_id}",
    "POST /api/v1/metrics/",
    "PATCH /api/v1/metrics/{metric_id}/verify",
    "POST /api/v1/notifications/read-all",
    "POST /api/v1/notifications/{notif_id}/read",
    "POST /api/v1/query/{query_id}/causal",
    "POST /api/v1/query/{query_id}/goal-seek",
    "POST /api/v1/query/{query_id}/monte-carlo",
    "POST /api/v1/query/{query_id}/significance",
    "POST /api/v1/saved/",
    "PUT /api/v1/saved/{saved_id}",
    "POST /api/v1/saved/{saved_id}/subscriptions",
    "POST /api/v1/workspaces",
    "PATCH /api/v1/workspaces/{workspace_id}",
    "POST /api/v1/workspaces/{workspace_id}/channels",
    "POST /api/v1/workspaces/{workspace_id}/leave",
    "POST /api/v1/workspaces/{workspace_id}/members",
    "PATCH /api/v1/workspaces/{workspace_id}/members/{member_id}",
    "POST /api/v1/workspaces/{workspace_id}/resources",
    "POST /api/v1/workspaces/{workspace_id}/transfer",
})


def _unlimited_mutating_routes() -> set[str]:
    from app.dependencies import enforce_rate_limit
    from app.main import app

    def dependency_calls(dependant, out=None):
        out = [] if out is None else out
        out.append(dependant.call)
        for sub in dependant.dependencies:
            dependency_calls(sub, out)
        return out

    unlimited = set()
    for route in app.routes:
        dependant = getattr(route, "dependant", None)
        if dependant is None:
            continue
        for method in getattr(route, "methods", set()) or set():
            if method not in ("POST", "PUT", "PATCH"):
                continue
            has_limit = any(
                call is enforce_rate_limit
                or "rate_limit.<locals>" in getattr(call, "__qualname__", "")
                for call in dependency_calls(dependant)
            )
            if not has_limit:
                unlimited.add(f"{method} {route.path}")
    return unlimited


def test_no_new_unlimited_mutating_route():
    added = _unlimited_mutating_routes() - _UNLIMITED_MUTATING_ROUTES
    assert not added, (
        "New mutating route(s) with neither an IP rate limit nor an AI quota. Add "
        "Depends(rate_limit(...)) or RateLimitedUser, or add them to "
        f"_UNLIMITED_MUTATING_ROUTES with a reason: {sorted(added)}"
    )


def test_rate_limit_baseline_has_no_stale_entries():
    """Keeps the ratchet honest — a fixed route must leave the list."""
    fixed = _UNLIMITED_MUTATING_ROUTES - _unlimited_mutating_routes()
    assert not fixed, f"These now have a limit; drop them from the baseline: {sorted(fixed)}"


# ─── 3. Identifier quoting is dialect-aware ───
#
# MySQL's default sql_mode reads "x" as a string literal, not an identifier, so
# `SELECT * FROM "sales"` silently selects the constant 'sales'. Composed SQL
# must go through explore_service.quote_ident, which is the only place that knows
# the difference.


@pytest.mark.parametrize(
    ("dialect", "expected"),
    [
        ("postgresql", '"sales"'),
        ("sqlite", '"sales"'),
        ("mysql", "`sales`"),
    ],
)
def test_quote_ident_covers_every_sql_dialect(dialect, expected):
    from app.services.explore_service import quote_ident

    assert quote_ident("sales", dialect) == expected


def test_every_dbtype_has_a_quoting_path():
    """A new DBType must be considered here, not silently double-quoted."""
    from app.models.datasource import DBType
    from app.services.explore_service import quote_ident

    for db_type in DBType:
        if db_type is DBType.powerbi:
            continue  # DAX, not SQL — never reaches a quoted identifier
        quoted = quote_ident("sales", db_type.value)
        assert quoted.strip('`"') == "sales"
        if db_type is DBType.mysql:
            assert quoted.startswith("`"), "MySQL identifiers must use backticks"


def test_no_unbounded_upload_read():
    """`await file.read()` with no size is an OOM waiting for a big enough POST.

    The body is fully materialised before any UPLOAD_MAX_BYTES check can run, so
    the limit is enforced on memory already spent. upload_service.read_bounded
    reads in chunks and stops at the limit.
    """
    offenders = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Await):
                continue
            call = node.value
            if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Attribute):
                continue
            if call.func.attr == "read" and not call.args and not call.keywords:
                offenders.append(f"{_module_name(path)}:{node.lineno}")

    assert not offenders, (
        "Unbounded await ....read() — use upload_service.read_bounded so the size "
        f"limit is enforced before the bytes are paid for: {offenders}"
    )


def test_no_hand_quoted_table_interpolation():
    """`f'... FROM "{table}"'` is the MySQL bug in source form — ban the shape."""
    offenders = []
    for path in _python_files():
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if 'FROM "{' in line or 'JOIN "{' in line or 'INTO "{' in line:
                offenders.append(f"{_module_name(path)}:{lineno}")

    assert not offenders, (
        "Hand-quoted identifier in composed SQL — breaks on MySQL, whose default "
        f"sql_mode reads \"x\" as a string literal. Use quote_ident: {offenders}"
    )


def test_every_completion_is_bounded_by_max_tokens():
    """An unbounded completion is an unbounded bill.

    ai/client.py holds the only calls into the chat API, and each must pass
    max_tokens. A fourth helper added later that forgets fails here rather than
    in the invoice.
    """
    import re

    source = (_APP / "ai" / "client.py").read_text(encoding="utf-8")
    creates = re.findall(r"chat\.completions\.create\((.*?)\n        \)", source, re.S)
    assert creates, "no chat.completions.create call found — did the file move?"
    missing = [c for c in creates if "max_tokens" not in c]
    assert not missing, (
        "every chat.completions.create must pass max_tokens; "
        f"{len(missing)} of {len(creates)} call(s) do not"
    )


def test_ai_call_sites_name_their_feature():
    """Unattributed spend is spend you cannot act on.

    Every chat_*/embed call outside client.py must pass feature=..., otherwise
    its cost lands in ai_spend_daily under "unknown" and the operator cannot
    tell which part of the product is expensive.
    """
    import re

    offenders = []
    for path in _python_files():
        if path.name == "client.py" and path.parent.name == "ai":
            continue
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(
            r"\b(chat_json|chat_text|chat_tools|embed)\(((?:[^()]|\([^()]*\))*)\)", text, re.S
        ):
            if "feature=" not in match.group(2):
                offenders.append(f"{_module_name(path)}: {match.group(1)}")

    assert not offenders, "AI calls without feature=: " + ", ".join(sorted(set(offenders)))


def test_every_database_enum_label_appears_in_a_migration():
    """A Postgres ENUM type does not learn new members on its own.

    SQLAlchemy does not diff enum members and neither does Alembic autogenerate,
    so adding a value to a Python enum changes nothing in the database. SQLite
    renders Enum as VARCHAR and accepts anything, which is what let this pass:
    `powerbi` joined DBType, no migration ever taught the type about it, the whole
    suite stayed green, and POST /datasource/connect-powerbi failed on every
    Postgres deployment with `invalid input value for enum dbtype`.

    This runs on SQLite, so it cannot ask a database; it reads the migrations for
    a statement that would create the label. The authoritative check is
    scripts/check_enum_labels.py, which deploy_smoke.sh runs against the real
    Postgres after `alembic upgrade head` -- that one proves the type exists. This
    one just fails in seconds instead of minutes.

    Labels are collected from `sa.Enum(...)` and `ALTER TYPE ... ADD VALUE`
    specifically, never from the file text. A first cut searched the whole file
    and was satisfied by the fixing migration's own docstring: deleting its
    op.execute left the test green, so the guard against this recurring did not
    guard against anything.
    """
    import re

    import sqlalchemy as sa

    import app.models  # noqa: F401 — populates Base.metadata
    from app.db.base import Base

    versions = _APP / "db" / "migrations" / "versions"
    text = "\n".join(p.read_text(encoding="utf-8") for p in versions.glob("*.py"))

    declared: set[str] = set()
    for args in re.findall(r"sa\.Enum\(([^)]*)\)", text):
        declared.update(re.findall(r"""['"]([^'"]+)['"]""", args))
    for label in re.findall(
        r"""ALTER\s+TYPE\s+\w+\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?['"]([^'"]+)['"]""",
        text, re.I,
    ):
        declared.add(label)

    missing = []
    for table in Base.metadata.tables.values():
        for col in table.columns:
            # A non-native Enum is a VARCHAR on every dialect: no type, nothing to
            # alter, and demanding a migration line for it would be busywork.
            if isinstance(col.type, sa.Enum) and getattr(col.type, "native_enum", True):
                for label in col.type.enums:
                    if label not in declared:
                        missing.append(f"{table.name}.{col.name} -> {label!r}")

    assert not missing, (
        "These enum labels exist in the models but no migration creates them, so "
        "the Postgres type does not accept them (SQLite hides this). Add a "
        f"migration with ALTER TYPE ... ADD VALUE: {missing}"
    )
