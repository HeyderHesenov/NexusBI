import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Database, Plus } from 'lucide-react'
import { QUIET_LINK } from '../ui/form'
import { useDatasourceStore } from '../../store/datasourceStore'
import { useQueryStore } from '../../store/queryStore'

/** Choose which source a query runs against: demo data or a connected source. */
export function DatasourcePicker() {
  const { t } = useTranslation()
  const { sources, load } = useDatasourceStore()
  const { datasourceId, setDatasource } = useQueryStore()

  useEffect(() => {
    load()
      .then(() => {
        // datasourceStore.remove() only clears the selection in the tab that did
        // the deleting. Without this, a source deleted elsewhere leaves a select
        // whose value matches no option: the browser shows the first one ("Demo
        // data") while every ask still posts the dead id and 404s.
        const fresh = useDatasourceStore.getState().sources
        const { datasourceId: current, setDatasource: pick } = useQueryStore.getState()
        if (current && !fresh.some((s) => s.id === current)) pick(null)
      })
      .catch(() => undefined)
  }, [load])

  return (
    <div className="inline-flex items-center gap-2">
      <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
        <Database size={14} className="text-accent" aria-hidden="true" />
        <select
          // The label holds only an icon, so an embedded control's own value is
          // all a screen reader would announce ("Demo data, combo box, Demo
          // data") with no hint of what the control decides.
          aria-label={t('queryPage.sourceLabel')}
          value={datasourceId ?? ''}
          onChange={(e) => setDatasource(e.target.value || null)}
          className="bg-transparent text-ink focus:outline-none"
        >
          <option value="">{t('queryPage.demoData')}</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {/* Adding a source lives on /sources and nothing here said so: a picker with
        * nothing of yours in it was a dead end, not a hint. */}
      <Link to="/sources" className={`${QUIET_LINK} py-2`}>
        <Plus size={13} aria-hidden="true" />
        {t('queryPage.addSource')}
      </Link>
    </div>
  )
}
