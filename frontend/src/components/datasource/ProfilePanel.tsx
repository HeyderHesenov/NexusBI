import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as dsApi from '../../api/datasource'
import * as api from '../../api/dataprep'
import type { DataProfile } from '../../types'

/** Per-column data profile for one datasource (null %, distinct, range). */
export function ProfilePanel({ datasourceId }: { datasourceId: string }) {
  const { t } = useTranslation()
  const [tables, setTables] = useState<string[]>([])
  const [table, setTable] = useState<string>('')
  const [profile, setProfile] = useState<DataProfile | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    dsApi
      .getSchema(datasourceId)
      .then((s) => {
        const names = Object.keys(s)
        setTables(names)
        setTable(names[0] ?? '')
      })
      .catch(() => setTables([]))
  }, [datasourceId])

  useEffect(() => {
    if (!table) return
    let active = true
    setLoading(true)
    setProfile(null)
    api
      .getProfile(datasourceId, table)
      .then((p) => active && setProfile(p))
      .catch(() => active && setProfile(null))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [datasourceId, table])

  if (tables.length === 0) {
    return <p className="text-sm text-ink-faint">{t('profilePanel.noTablesFound')}</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">{t('profilePanel.table')}</span>
        <select
          value={table}
          onChange={(e) => setTable(e.target.value)}
          className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-none"
        >
          {tables.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {profile && (
          <span className="font-mono text-[10px] text-ink-faint">
            {t('profilePanel.rowSample', { n: profile.row_sample })}
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-ink-faint">{t('profilePanel.loading')}</p>
      ) : profile ? (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface">
              <tr className="text-ink-faint">
                <th className="px-3 py-1.5 font-medium">{t('profilePanel.column')}</th>
                <th className="px-3 py-1.5 font-medium">{t('profilePanel.type')}</th>
                <th className="px-3 py-1.5 font-medium">{t('profilePanel.nullPct')}</th>
                <th className="px-3 py-1.5 font-medium">{t('profilePanel.distinct')}</th>
                <th className="px-3 py-1.5 font-medium">{t('profilePanel.min')}</th>
                <th className="px-3 py-1.5 font-medium">{t('profilePanel.max')}</th>
              </tr>
            </thead>
            <tbody>
              {profile.columns.map((c) => (
                <tr key={c.column} className="border-t border-line">
                  <td className="px-3 py-1.5 font-mono text-ink">{c.column}</td>
                  <td className="px-3 py-1.5 text-ink-soft">{c.dtype}</td>
                  <td className="px-3 py-1.5 text-ink-soft">{c.null_pct}%</td>
                  <td className="px-3 py-1.5 text-ink-soft">{c.distinct}</td>
                  <td className="px-3 py-1.5 text-ink-soft">{c.min ?? '—'}</td>
                  <td className="px-3 py-1.5 text-ink-soft">{c.max ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-faint">{t('profilePanel.notAvailable')}</p>
      )}
    </div>
  )
}
