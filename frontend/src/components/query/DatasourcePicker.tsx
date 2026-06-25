import { useEffect } from 'react'
import { Database } from 'lucide-react'
import { useDatasourceStore } from '../../store/datasourceStore'
import { useQueryStore } from '../../store/queryStore'

/** Choose which source a query runs against: demo data or a connected source. */
export function DatasourcePicker() {
  const { sources, load } = useDatasourceStore()
  const { datasourceId, setDatasource } = useQueryStore()

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
      <Database size={14} className="text-accent" />
      <select
        value={datasourceId ?? ''}
        onChange={(e) => setDatasource(e.target.value || null)}
        className="bg-transparent text-ink focus:outline-none"
      >
        <option value="">Demo data</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}
