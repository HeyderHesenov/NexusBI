"""Ingest an uploaded CSV/Excel file into a per-source SQLite database.

The resulting SQLite file becomes a normal DataSource (db_type=sqlite), so the
existing NL→SQL→execute pipeline and SELECT-only guard apply unchanged.
"""
from __future__ import annotations

import re
import uuid
from io import BytesIO
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine

from app.config import settings
from app.core.exceptions import NexusBIException

MAX_ROWS = 100_000
MAX_COLS = 100
_ALLOWED = {".csv", ".xlsx"}


def _sanitize(name: str, fallback: str) -> str:
    """Make a safe SQL identifier: alnum + underscore, non-empty, not leading digit."""
    cleaned = re.sub(r"\W+", "_", name.strip()).strip("_")
    if not cleaned or cleaned[0].isdigit():
        cleaned = f"{fallback}_{cleaned}" if cleaned else fallback
    return cleaned[:63]


def _dedupe(columns: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out: list[str] = []
    for i, col in enumerate(columns):
        base = _sanitize(str(col), f"col_{i}")
        n = seen.get(base, 0)
        seen[base] = n + 1
        out.append(base if n == 0 else f"{base}_{n}")
    return out


def ingest_file(filename: str, content: bytes) -> tuple[str, str, int]:
    """Parse CSV/Excel bytes into a fresh SQLite DB. Returns (conn_str, table, rows)."""
    ext = Path(filename).suffix.lower()
    if ext not in _ALLOWED:
        raise NexusBIException("Yalnız .csv və ya .xlsx faylları dəstəklənir.")
    if len(content) > settings.UPLOAD_MAX_BYTES:
        raise NexusBIException("Fayl çox böyükdür (maks. 10 MB).")

    try:
        if ext == ".csv":
            df = pd.read_csv(BytesIO(content))
        else:
            df = pd.read_excel(BytesIO(content))
    except Exception as exc:  # noqa: BLE001
        raise NexusBIException("Fayl oxunmadı — formatı yoxlayın.", detail=str(exc)) from exc

    if df.empty:
        raise NexusBIException("Fayl boşdur.")
    if df.shape[1] > MAX_COLS:
        raise NexusBIException(f"Çox sütun var (maks. {MAX_COLS}).")
    if df.shape[0] > MAX_ROWS:
        df = df.head(MAX_ROWS)

    df.columns = _dedupe(list(df.columns))
    table = _sanitize(Path(filename).stem, "data")
    return _write_sqlite(df, table)


def _write_sqlite(df: "pd.DataFrame", table: str) -> tuple[str, str, int]:
    """Persist a dataframe to a fresh per-source SQLite DB. Returns (conn_str, table, rows)."""
    upload_dir = Path(settings.UPLOAD_DIR)
    upload_dir.mkdir(parents=True, exist_ok=True)
    db_path = (upload_dir / f"{uuid.uuid4()}.db").resolve()

    # pandas needs a sync engine for to_sql; queries later use the async driver.
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        df.to_sql(table, engine, index=False, if_exists="replace")
    finally:
        engine.dispose()

    return f"sqlite+aiosqlite:///{db_path}", table, len(df)


def materialize_rows(
    columns: list[str], rows: list[dict], name: str
) -> tuple[str, str, int]:
    """Persist transform result rows into a new SQLite-backed datasource.

    Used by NL data-prep to save a derived table. Returns (conn_str, table, rows).
    """
    if not rows:
        raise NexusBIException("Saxlamaq üçün sətir yoxdur.")
    df = pd.DataFrame(rows, columns=columns or None)
    if df.empty:
        raise NexusBIException("Saxlamaq üçün sətir yoxdur.")
    if df.shape[1] > MAX_COLS:
        raise NexusBIException(f"Çox sütun var (maks. {MAX_COLS}).")
    if df.shape[0] > MAX_ROWS:
        df = df.head(MAX_ROWS)
    df.columns = _dedupe(list(df.columns))
    table = _sanitize(name, "derived")
    return _write_sqlite(df, table)
