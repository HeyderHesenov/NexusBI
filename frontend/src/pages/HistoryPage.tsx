import { useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { useQueryStore } from '../store/queryStore'
import { HistoryDeleteUI } from '../components/query/HistoryDeleteUI'
import { useHistoryDelete } from '../hooks/useHistoryDelete'

export function HistoryPage() {
  const { history, loadHistory } = useQueryStore()
  const del = useHistoryDelete()
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
              {['Sorğu', 'Chart', 'ms', 'Tarix', ''].map((h, i) => (
                <th
                  key={i}
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
                <td colSpan={5} className="px-5 py-10 text-center text-ink-soft">
                  Hələ sorğu yoxdur.
                </td>
              </tr>
            ) : (
              history.map((h) => (
                <tr
                  key={h.id}
                  onContextMenu={(e) => del.openMenu(h.id, e)}
                  className="group border-t border-line transition hover:bg-surface-2"
                >
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
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => del.askDelete(h.id)}
                      aria-label="Sorğunu sil"
                      className="rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-surface hover:text-[#D87C6B] focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <HistoryDeleteUI del={del} />
    </div>
  )
}
