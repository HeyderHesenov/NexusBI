import { useMemo, useState } from 'react'

interface Props {
  data: Record<string, unknown>[]
}

export function TableWidget({ data }: Props) {
  const columns = useMemo(() => (data[0] ? Object.keys(data[0]) : []), [data])
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [asc, setAsc] = useState(true)

  const rows = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const av = a[sortKey] as never
      const bv = b[sortKey] as never
      if (av === bv) return 0
      return (av > bv ? 1 : -1) * (asc ? 1 : -1)
    })
  }, [data, sortKey, asc])

  if (!columns.length) return <p className="text-ink-soft">Nəticə yoxdur.</p>

  return (
    <div className="max-h-96 overflow-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-surface-2">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                onClick={() => {
                  if (sortKey === c) setAsc(!asc)
                  else {
                    setSortKey(c)
                    setAsc(true)
                  }
                }}
                className="cursor-pointer border-b border-line px-4 py-2.5 font-mono text-[11px] uppercase tracking-wider text-ink-soft transition hover:text-accent"
              >
                {c}
                {sortKey === c ? (asc ? ' ↑' : ' ↓') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-line transition hover:bg-surface-2">
              {columns.map((c) => (
                <td key={c} className="px-4 py-2.5 text-ink">
                  {String(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
