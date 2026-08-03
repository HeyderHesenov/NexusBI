import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { SourceSelect } from '../datasource/SourceSelect'
import { useDatasourceStore } from '../../store/datasourceStore'
import { useQueryStore } from '../../store/queryStore'

/** Choose which source a query runs against: demo data or a connected source. */
export function DatasourcePicker() {
  const { t } = useTranslation()
  const { sources, load } = useDatasourceStore()
  const { datasourceId, setDatasource } = useQueryStore()
  const [settled, setSettled] = useState(false)

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
      .finally(() => setSettled(true))
  }, [load])

  // Spell the action out only while the picker has nothing of your own to offer;
  // once you have sources the "+" is a known affordance and the row is tight.
  // Gated on a local `settled` rather than the store's `loading`: that starts
  // false and only flips inside the effect, i.e. one commit after first paint,
  // so a user who has sources would still see the label flash for a frame.
  const showLabel = settled && sources.length === 0

  return (
    <SourceSelect
      value={datasourceId}
      onChange={setDatasource}
      label={t('queryPage.sourceLabel')}
      demoLabel={t('queryPage.demoData')}
      sources={sources}
      trailing={
        // Adding a source lives on /sources and nothing here said so: a picker with
        // nothing of yours in it was a dead end, not a hint. Stays a <Link> so
        // cmd-click and open-in-new-tab keep working, and so it reads as a link.
        <Link
          to="/sources"
          aria-label={t('queryPage.addSource')}
          // Only when the icon stands alone — repeating a visible label in a
          // tooltip buys nothing and screen readers read it twice.
          title={showLabel ? undefined : t('queryPage.addSource')}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-xs font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <Plus size={14} aria-hidden="true" />
          {showLabel && t('queryPage.addSource')}
        </Link>
      }
    />
  )
}
