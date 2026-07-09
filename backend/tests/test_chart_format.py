"""Deterministic chart display-format inference (ai/chart_format + ChartConfig)."""
import pytest

from app.ai.chart_format import humanize, infer_format
from app.ai.chart_selector import rule_based_chart
from app.ai.types import ChartConfig, ChartFormat
from app.config import settings


@pytest.mark.parametrize("column", ["conversion_pct", "pct_change", "percentage", "percent_used"])
def test_percent_columns(column):
    fmt = infer_format(column)
    assert fmt == {"unit": "%", "decimals": 1}


@pytest.mark.parametrize("column", ["rate", "hourly_rate", "market_share", "ratio"])
def test_ambiguous_scale_names_get_no_percent(column):
    # rate/ratio/share may be 0-1 scaled or not percents at all (hourly_rate is
    # money) — a wrong "%" is worse than none.
    fmt = infer_format(column)
    assert fmt is None or fmt.get("unit") != "%"


@pytest.mark.parametrize("column", ["order_count", "qty", "quantity", "num_users", "units"])
def test_count_columns_are_whole_numbers(column):
    assert infer_format(column) == {"decimals": 0}


def test_money_without_configured_currency_gives_no_format(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_CURRENCY_CODE", "")
    assert infer_format("total_revenue") is None


def test_money_with_configured_currency(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_CURRENCY_CODE", "AZN")
    assert infer_format("total_revenue") == {"currency": "AZN", "decimals": 2}


@pytest.mark.parametrize("column", [None, "", "region", "customer_name", "discounted"])
def test_unknown_columns_have_no_format(column):
    assert infer_format(column) is None


def test_substring_does_not_match():
    assert infer_format("rating") is None
    assert infer_format("accountant") is None  # not "count"


def test_humanize():
    assert humanize("total_revenue") == "Total Revenue"
    assert humanize("region") == "Region"
    assert humanize(None) is None
    assert humanize("") is None


def test_chart_config_autofills_on_construction(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_CURRENCY_CODE", "USD")
    cfg = ChartConfig(chart_type="bar", x_axis="region", y_axis="total_revenue")
    assert cfg.x_label == "Region"
    assert cfg.y_label == "Total Revenue"
    assert cfg.format is not None and cfg.format.currency == "USD"


def test_chart_config_never_overwrites_explicit_values():
    cfg = ChartConfig(
        chart_type="line",
        x_axis="month",
        y_axis="order_count",
        format=ChartFormat(unit="ədəd"),
        x_label="Ay",
    )
    assert cfg.format is not None and cfg.format.unit == "ədəd"
    assert cfg.x_label == "Ay"
    assert cfg.y_label == "Order Count"  # only the missing label is filled


def test_persisted_config_without_hints_is_backfilled_on_parse():
    # Query logs / cache entries / dashboard snapshots saved BEFORE this
    # feature lack the fields — re-parsing them must enrich for free.
    cfg = ChartConfig(**{"chart_type": "bar", "x_axis": "region", "y_axis": "order_count"})
    assert cfg.y_label == "Order Count"
    assert cfg.format is not None and cfg.format.decimals == 0


def test_rule_based_chart_is_enriched():
    rows = [{"region": "Baku", "order_count": 10}, {"region": "Ganja", "order_count": 5}]
    cfg = rule_based_chart(["region", "order_count"], rows)
    assert cfg.y_label == "Order Count"
    assert cfg.format is not None and cfg.format.decimals == 0


def test_axisless_config_stays_bare():
    cfg = ChartConfig(chart_type="table")
    assert cfg.format is None and cfg.x_label is None and cfg.y_label is None
