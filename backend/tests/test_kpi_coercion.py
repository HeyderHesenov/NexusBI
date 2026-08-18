"""What a model proposes as an acceptance criterion, and what we agree to store.

These two coercers are the only writers of `KpiItem.target_value` / `.direction`,
and those become `Decision.predicted_value` / `.predicted_direction` — the pair
`_compute_impact_status` reads to decide "achieved". So a wrong answer here does
not render badly, it reports the wrong verdict on someone's requirement.

Both functions are allowed to return None freely (the user then types the number
themselves). What they may never do is invent a number or invert a direction.
"""
from __future__ import annotations

import math

import pytest

from app.ai.requirements import _coerce_direction, _coerce_target


# ─── target: types that must never look like a number ───

def test_bool_is_not_a_target():
    # float(True) == 1.0, so a JSON `true` would otherwise store a perfectly
    # plausible target of 1 and no one would ever notice.
    assert _coerce_target(True) is None
    assert _coerce_target(False) is None


@pytest.mark.parametrize(
    "value", [{"value": 15}, [15], (15,), {15}, None, object(), b"15"]
)
def test_non_scalars_are_not_targets(value):
    assert _coerce_target(value) is None


@pytest.mark.parametrize(
    "value", ["", "   ", "null", "None", "n/a", "NA", "-", "—", "yes", "no", "true"]
)
def test_placeholder_words_are_not_targets(value):
    assert _coerce_target(value) is None


# ─── target: the number, scaled exactly as written ───

@pytest.mark.parametrize("value", ["15%", "15 percent", "15 faiz", "%15", "15 yüzde"])
def test_percent_is_not_rescaled(value):
    # predicted_value is compared against extract_scalar() of the metric query,
    # and "konversiya faizi nədir?" answers 15 from SQL — not 0.15. Dividing by
    # 100 here would mint a criterion that can never be met.
    assert _coerce_target(value) == 15.0


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("15.5", 15.5),
        ("15,5", 15.5),        # Azerbaijani decimal comma
        ("1,500", 1500.0),     # thousands group, either spelling
        ("1.500", 1500.0),
        ("1.234,56", 1234.56),  # both separators, comma decides
        ("1,234.56", 1234.56),  # both separators, dot decides
        ("1.234.567", 1234567.0),
        ("12 000", 12000.0),
        (">= 20", 20.0),
        ("~1000", 1000.0),
        ("$1,200", 1200.0),
        ("₼500", 500.0),
        ("-3.5", -3.5),
    ],
)
def test_separators_and_noise(value, expected):
    assert _coerce_target(value) == expected


@pytest.mark.parametrize(
    "value", ["12%-15%", "10 to 20", "between 5 and 9", "10–20", "5, 6, 7"]
)
def test_a_range_is_refused_rather_than_halved(value):
    # Taking an end of a range is how you end up enforcing a threshold nobody
    # wrote. Two number tokens means "not one number", so: None.
    assert _coerce_target(value) is None


# ─── target: magnitude ───

def test_non_finite_is_refused():
    assert _coerce_target(float("nan")) is None
    assert _coerce_target(float("inf")) is None
    assert _coerce_target(float("-inf")) is None
    # inf in predicted_value makes `realized >= predicted` permanently False,
    # i.e. "achieved" becomes unreachable rather than merely wrong.
    assert _coerce_target(1e400) is None


def test_magnitude_ceiling_is_pinned_from_both_sides():
    # Absolute literals, NOT _MAX_TARGET_MAGNITUDE arithmetic: a bound written in
    # terms of the constant it guards moves with it and can never fail.
    assert _coerce_target(1e15) == 1e15
    assert _coerce_target(1e16) is None
    assert _coerce_target(-1e16) is None
    assert _coerce_target("1000000000000000") == 1e15
    assert _coerce_target("10000000000000000") is None


def test_zero_is_a_real_target_and_keeps_its_sign():
    # "səhv sayı 0 olmalıdır" is a legitimate criterion. It is also falsy, which
    # is why every reader of this value must test `is not None`.
    assert _coerce_target(0) == 0.0
    assert _coerce_target("0") == 0.0
    assert math.copysign(1.0, _coerce_target(-0.0)) == 1.0


# ─── direction ───

@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("increase", "increase"), ("Increase", "increase"), ("GROWTH", "increase"),
        ("up", "increase"), ("↑", "increase"),
        ("artım", "increase"), ("ARTIM", "increase"), ("artmalı", "increase"),
        ("decrease", "decrease"), ("Reduce", "decrease"), ("DROP", "decrease"),
        ("↓", "decrease"),
        ("azalma", "decrease"), ("AZALMALI", "decrease"), ("aşağı", "decrease"),
    ],
)
def test_known_direction_words(value, expected):
    assert _coerce_direction(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        "increase then decrease",
        "not decrease",
        "decrease is bad, increase",
        "should not increase",
        "no change",
        "sideways",
        "-",
        "+",
    ],
)
def test_ambiguous_phrases_never_resolve_to_a_direction(value):
    # THE inversion guard. Every phrase above contains a direction keyword, so a
    # substring scan would return whichever branch it happened to test first —
    # and reporting "achieved" for the outcome the requirement forbids is the
    # worst failure this feature can have. Exact lookup only.
    assert _coerce_direction(value) is None


@pytest.mark.parametrize("value", [True, False, 1, 0, {"d": "up"}, ["up"], None, 1.5])
def test_non_strings_are_not_directions(value):
    assert _coerce_direction(value) is None


# ─── totality ───

_HOSTILE = [
    None, True, False, 0, 1, -1, 1.5, -0.0, 1e400, float("nan"), float("inf"),
    "", " ", "\n", "null", "NULL", "n/a", "-", "—", "yes", "true", "abc",
    "15", "15%", "15,5", "1,500", "1.234,56", "12%-15%", "10 to 20", "1e15",
    "increase", "DECREASE", "artım", "increase then decrease", "↑", "↓",
    {"a": 1}, [1, 2], (1,), {1}, object(), b"15", "٢٥", "２５", "٪15",
]


@pytest.mark.parametrize("value", _HOSTILE)
def test_coercers_are_total(value):
    """Neither coercer may raise or return an out-of-contract value, ever.

    This is what pays for KpiItem.direction being a strict Literal: anything the
    normalizer lets through reaches Pydantic, and a value outside the two allowed
    strings would 500 the whole requirements list rather than one KPI.
    """
    target = _coerce_target(value)
    assert target is None or (isinstance(target, float) and math.isfinite(target))

    direction = _coerce_direction(value)
    assert direction in (None, "increase", "decrease")
