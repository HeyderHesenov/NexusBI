import { Columns3, GitFork, Table2, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Lineage } from '../../types'

function Row({ icon, label, items }: { icon: React.ReactNode; label: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-ink-faint">{icon}</span>
      <div className="min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</span>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {items.map((it) => (
            <span
              key={it}
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-soft"
            >
              {it}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Deterministic lineage: which tables/columns/metrics this result came from. */
export function LineagePanel({ lineage }: { lineage: Lineage }) {
  const { t } = useTranslation()
  const empty =
    lineage.tables.length === 0 && lineage.columns.length === 0 && lineage.metrics.length === 0
  return (
    <div className="space-y-2.5 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        <GitFork size={15} className="text-accent" />
        <p className="eyebrow text-ink-soft">{t('lineagePanel.title')}</p>
      </div>
      {empty ? (
        <p className="text-sm text-ink-faint">{t('lineagePanel.empty')}</p>
      ) : (
        <>
          <Row icon={<Table2 size={13} />} label={t('lineagePanel.tables')} items={lineage.tables} />
          <Row icon={<Columns3 size={13} />} label={t('lineagePanel.columns')} items={lineage.columns} />
          <Row icon={<Tag size={13} />} label={t('lineagePanel.metrics')} items={lineage.metrics} />
        </>
      )}
    </div>
  )
}
