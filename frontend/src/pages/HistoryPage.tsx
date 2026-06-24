import { useEffect } from 'react'
import { useQueryStore } from '../store/queryStore'

export function HistoryPage() {
  const { history, loadHistory } = useQueryStore()
  useEffect(() => {
    loadHistory().catch(() => undefined)
  }, [loadHistory])

  return (
    <div>
      <p className="eyebrow">Jurnal</p>
      <h2 className="mb-6 mt-1 font-display text-3xl font-bold text-ink">Sorğu tarixçəsi</h2>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {['Sorğu', 'Chart', 'ms', 'Tarix'].map((h) => (
                <th
                  key={h}
                  className="px-5 py-3 font-mono text-[11px] uppercase tracking-wider text-ink-faint"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-ink-soft">
                  Hələ sorğu yoxdur.
                </td>
              </tr>
            ) : (
              history.map((h) => (
                <tr key={h.id} className="border-t border-line transition hover:bg-surface-2">
                  <td className="px-5 py-3 text-ink">{h.natural_language}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent">
                      {h.chart_type}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-ink-soft">{h.execution_time_ms}</td>
                  <td className="px-5 py-3 font-mono text-xs text-ink-faint">
                    {h.created_at.slice(0, 19).replace('T', ' ')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
