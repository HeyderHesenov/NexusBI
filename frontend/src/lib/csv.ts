/** Serialize rows to CSV and trigger a browser download. */
export function downloadCsv(
  rows: Record<string, unknown>[],
  filename = 'nexusbi-export.csv',
): void {
  if (!rows.length) return
  const columns = Object.keys(rows[0])
  const escape = (v: unknown) => {
    let s = v == null ? '' : String(v)
    // Neutralize CSV formula injection (Excel/Sheets evaluate =,+,-,@ leads).
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => escape(r[c])).join(',')),
  ].join('\n')

  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
