import { useEffect } from 'react'
import { useQueryStore } from '../store/queryStore'

export function HistoryPage() {
  const { history, loadHistory } = useQueryStore()
  useEffect(() => {
    loadHistory().catch(() => undefined)
  }, [loadHistory])

  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-slate-100">Sorğu tarixçəsi</h2>
      <div className="overflow-auto rounded-xl border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-3 py-2">Sorğu</th>
              <th className="px-3 py-2">Chart</th>
              <th className="px-3 py-2">ms</th>
              <th className="px-3 py-2">Tarix</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} className="border-t border-slate-800">
                <td className="px-3 py-2 text-slate-200">{h.natural_language}</td>
                <td className="px-3 py-2 text-slate-400">{h.chart_type}</td>
                <td className="px-3 py-2 text-slate-400">{h.execution_time_ms}</td>
                <td className="px-3 py-2 text-slate-500">{h.created_at.slice(0, 19)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
