import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Table2 } from 'lucide-react'
import { useDatasourceStore } from '../../store/datasourceStore'
import type { DataSourceSchema } from '../../types'

/** Compact, collapsible schema (tables → columns) for the active datasource. */
export function SchemaBrowser({ datasourceId }: { datasourceId: string }) {
  const { t } = useTranslation()
  const loadSchema = useDatasourceStore((s) => s.loadSchema)
  const [schema, setSchema] = useState<DataSourceSchema | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    setSchema(null)
    loadSchema(datasourceId)
      .then(setSchema)
      .catch(() => setSchema({}))
  }, [datasourceId, loadSchema])

  if (!schema) return <p className="text-sm text-ink-faint">{t('schemaBrowser.loading')}</p>
  const tables = Object.entries(schema)
  if (!tables.length) return <p className="text-sm text-ink-faint">{t('schemaBrowser.notFound')}</p>

  return (
    <ul className="space-y-0.5">
      {tables.map(([table, cols]) => {
        const expanded = open === table
        return (
          <li key={table}>
            <button
              onClick={() => setOpen(expanded ? null : table)}
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-ink-soft transition hover:bg-surface hover:text-ink"
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Table2 size={13} className="text-accent" />
              <span className="truncate font-mono text-xs">{table}</span>
              <span className="ml-auto font-mono text-[10px] text-ink-faint">{cols.length}</span>
            </button>
            {expanded && (
              <ul className="ml-7 border-l border-line pl-2">
                {cols.map((c) => (
                  <li key={c.name} className="flex items-baseline justify-between gap-2 py-0.5">
                    <span className="truncate font-mono text-[11px] text-ink">{c.name}</span>
                    <span className="font-mono text-[10px] text-ink-faint">{c.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
