"""Render a query result to a report file (Excel via openpyxl, PDF via reportlab).

Pure, dependency-light rendering — no network, no DB. Fed the columns + rows of a
saved-query result and returns file bytes + a filename + a MIME type, ready to
attach to an email.
"""
from __future__ import annotations

import re
from io import BytesIO
from typing import Any

# PDF is paginated and meant for a human glance — cap rows so a huge result set
# doesn't produce a thousand-page attachment. Excel keeps the full set.
_PDF_MAX_ROWS = 1000

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF_MIME = "application/pdf"


def _slug(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", name.strip()).strip("-")
    return s[:60] or "report"


def render_xlsx(name: str, columns: list[str], rows: list[dict[str, Any]]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Hesabat"
    if not columns:
        ws.append(["Nəticə yoxdur"])
    else:
        ws.append(columns)
        for row in rows:
            ws.append([row.get(c) for c in columns])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def render_pdf(name: str, columns: list[str], rows: list[dict[str, Any]]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), title=name)
    styles = getSampleStyleSheet()
    elements: list[Any] = [Paragraph(name, styles["Title"]), Spacer(1, 12)]

    if not columns:
        # reportlab's Table raises on a zero-column grid — degrade to a note.
        elements.append(Paragraph("Nəticə yoxdur.", styles["Normal"]))
        doc.build(elements)
        return buf.getvalue()

    capped = rows[:_PDF_MAX_ROWS]
    grid = [columns] + [[str(r.get(c, "")) for c in columns] for r in capped]
    table = Table(grid, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0E9F6E")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E3DC")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F4EE")]),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    elements.append(table)
    if len(rows) > _PDF_MAX_ROWS:
        elements.append(Spacer(1, 8))
        elements.append(
            Paragraph(f"… {len(rows) - _PDF_MAX_ROWS} əlavə sətir kəsildi.", styles["Italic"])
        )
    doc.build(elements)
    return buf.getvalue()


def render(
    fmt: str, name: str, columns: list[str], rows: list[dict[str, Any]]
) -> tuple[bytes, str, str]:
    """Render to ``fmt`` ('xlsx' | 'pdf'). Returns (bytes, filename, mime_type)."""
    slug = _slug(name)
    if fmt == "xlsx":
        return render_xlsx(name, columns, rows), f"{slug}.xlsx", XLSX_MIME
    return render_pdf(name, columns, rows), f"{slug}.pdf", PDF_MIME
