import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Database, Plus } from 'lucide-react'
import { useDatasourceStore } from '../../store/datasourceStore'
import { useQueryStore } from '../../store/queryStore'

/** Choose which source a query runs against: demo data or a connected source. */
export function DatasourcePicker() {
  const { t } = useTranslation()
  const { sources, load } = useDatasourceStore()
  const { datasourceId, setDatasource } = useQueryStore()

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <div className="inline-flex items-center gap-2">
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
      {/* Adding a source lives on /sources and nothing here said so: a picker with
        * nothing of yours in it was a dead end, not a hint. */}
      <Link
        to="/sources"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-2 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-accent"
      >
        <Plus size={13} aria-hidden="true" />
        {t('queryPage.addSource')}
      </Link>
    </div>
  )
}
