import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { BarChart3, Database, Gauge, Loader2, Plug, Plus, RefreshCw, ShieldHalf, Sparkles, Table2, Trash2, UploadCloud, Wand2 } from 'lucide-react'
import { useDatasourceStore } from '../store/datasourceStore'
import { useDashboardStore } from '../store/dashboardStore'
import { useQueryStore } from '../store/queryStore'
import * as dsApi from '../api/datasource'
import type { DataSourceSchema } from '../types'
import { ConnectSourceModal } from '../components/datasource/ConnectSourceModal'
import { ConnectPowerBIModal } from '../components/datasource/ConnectPowerBIModal'
import { UploadSourceModal } from '../components/datasource/UploadSourceModal'
import { DataPrepModal } from '../components/datasource/DataPrepModal'
import { ProfilePanel } from '../components/datasource/ProfilePanel'
import { RlsModal } from '../components/datasource/RlsModal'
import { SkeletonRows } from '../components/ui/Skeleton'

/** Parse a server timestamp as UTC even when it lacks a tz suffix (SQLite stores
 *  naive datetimes; without this the browser would read them as local time). */
function parseUtc(ts: string): number {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts)
  return new Date(hasTz ? ts : `${ts}Z`).getTime()
}

/** Freshness status from last refresh + SLA: ok / stale / unknown. */
function freshness(s: { last_refreshed_at?: string | null; freshness_sla_hours?: number | null }) {
  if (!s.last_refreshed_at) return { tone: 'text-ink-faint', dot: 'bg-ink-faint', labelKey: 'dataSourcesPage.freshnessUnknown' }
  const ageH = (Date.now() - parseUtc(s.last_refreshed_at)) / 3_600_000
  if (s.freshness_sla_hours && ageH > s.freshness_sla_hours)
    return { tone: 'text-[#D87C6B]', dot: 'bg-[#D87C6B]', labelKey: 'dataSourcesPage.freshnessStale' }
  return { tone: 'text-accent', dot: 'bg-accent', labelKey: 'dataSourcesPage.freshnessFresh' }
}

export function DataSourcesPage() {
  const { t } = useTranslation()
  const { sources, loading, load, test, remove, setSla, replaceData } = useDatasourceStore()
  const explore = useDashboardStore((s) => s.explore)
  const { datasourceId, setDatasource } = useQueryStore()
  const navigate = useNavigate()
  const refreshInputRef = useRef<HTMLInputElement | null>(null)
  const [refreshId, setRefreshId] = useState<string | null>(null)
  const [exploringId, setExploringId] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [powerbiOpen, setPowerbiOpen] = useState(false)
  const [prepOpen, setPrepOpen] = useState(false)
  const [openSchema, setOpenSchema] = useState<string | null>(null)
  const [schema, setSchema] = useState<DataSourceSchema | null>(null)
  const [openProfile, setOpenProfile] = useState<string | null>(null)
  const [rlsFor, setRlsFor] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  // Re-upload a fresh file into an existing file-backed source (keeps its id, so
  // every saved query / widget stays wired). One hidden input, reused per row.
  const pickRefreshFile = (id: string) => {
    setRefreshId(id)
    refreshInputRef.current?.click()
  }
  const onRefreshFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be picked again next time
    const id = refreshId
    setRefreshId(null)
    if (!file || !id) return
    try {
      const res = await replaceData(id, file)
      if (res.warnings.length) {
        toast(t('dataSourcesPage.refreshWarning', { n: res.warnings.length, items: res.warnings.join(', ') }), {
          icon: '⚠️',
        })
      } else {
        toast.success(t('dataSourcesPage.refreshed', { rows: res.rows }))
      }
    } catch {
      // the axios interceptor already surfaced the API error
    }
  }

  // One-click Explore: build a deterministic dashboard from the source, then open it.
  const onExplore = async (id: string) => {
    setExploringId(id)
    try {
      await explore(id)
      toast.success(t('dataSourcesPage.exploreDone'))
      navigate('/dashboards')
    } catch {
      // the axios interceptor already surfaced the API error
    } finally {
      setExploringId(null)
    }
  }

  const toggleSchema = async (id: string) => {
    if (openSchema === id) {
      setOpenSchema(null)
      return
    }
    setOpenSchema(id)
    setSchema(null)
    try {
      setSchema(await dsApi.getSchema(id))
    } catch {
      setSchema({})
    }
  }

  return (
    <div className="w-full">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('dataSourcesPage.eyebrow')}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
            {t('dataSourcesPage.title')}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t('dataSourcesPage.subtitle')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            onClick={() => setPrepOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
          >
            <Wand2 size={15} /> {t('dataSourcesPage.prepData')}
          </button>
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
          >
            <UploadCloud size={15} /> CSV/Excel
          </button>
          <button
            onClick={() => setPowerbiOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-accent hover:text-ink"
          >
            <BarChart3 size={15} /> Power BI
          </button>
          <button
            onClick={() => setConnectOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
          >
            <Plus size={15} /> {t('dataSourcesPage.connectDb')}
          </button>
        </div>
      </header>

      {loading && sources.length === 0 ? (
        <SkeletonRows rows={5} rowClassName="h-20" />
      ) : sources.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <Database size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">{t('dataSourcesPage.emptyTitle')}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {t('dataSourcesPage.emptyDesc')}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {sources.map((s) => (
            <li key={s.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface-2">
                    {s.db_type === 'powerbi' ? (
                      <BarChart3 size={16} className="text-[#F2C811]" />
                    ) : (
                      <Database size={16} className="text-accent" />
                    )}
                  </span>
                  <div>
                    <p className="font-medium text-ink">{s.name}</p>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                      {s.db_type}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setDatasource(datasourceId === s.id ? null : s.id)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                      datasourceId === s.id
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line text-ink-soft hover:text-ink'
                    }`}
                  >
                    {datasourceId === s.id ? t('dataSourcesPage.active') : t('dataSourcesPage.select')}
                  </button>
                  {s.db_type !== 'powerbi' && (
                    <button
                      onClick={() => onExplore(s.id)}
                      disabled={exploringId === s.id}
                      title={t('dataSourcesPage.exploreTitle')}
                      className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent hover:text-bg disabled:opacity-60"
                    >
                      {exploringId === s.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Sparkles size={13} />
                      )}
                      {t('dataSourcesPage.explore')}
                    </button>
                  )}
                  <button
                    onClick={() => toggleSchema(s.id)}
                    title="Schema"
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:text-ink"
                  >
                    <Table2 size={15} />
                  </button>
                  {s.db_type !== 'powerbi' && (
                    <button
                      onClick={() => setOpenProfile(openProfile === s.id ? null : s.id)}
                      title={t('dataSourcesPage.profileTitle')}
                      className={`rounded-lg border p-1.5 transition ${
                        openProfile === s.id
                          ? 'border-accent text-accent'
                          : 'border-line text-ink-soft hover:text-ink'
                      }`}
                    >
                      <Gauge size={15} />
                    </button>
                  )}
                  {s.db_type !== 'powerbi' && (
                    <button
                      onClick={() => setRlsFor({ id: s.id, name: s.name })}
                      title={t('dataSourcesPage.rlsTitle')}
                      className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent"
                    >
                      <ShieldHalf size={15} />
                    </button>
                  )}
                  {s.db_type === 'sqlite' && (
                    <button
                      onClick={() => pickRefreshFile(s.id)}
                      title={t('dataSourcesPage.refreshDataTitle')}
                      className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent"
                    >
                      <RefreshCw size={15} />
                    </button>
                  )}
                  <button
                    onClick={() => test(s.id)}
                    title={t('dataSourcesPage.testConnectionTitle')}
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:text-ink"
                  >
                    <Plug size={15} />
                  </button>
                  <button
                    onClick={() => remove(s.id)}
                    title={t('dataSourcesPage.deleteTitle')}
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {s.db_type !== 'powerbi' && (
                <div className="mt-2.5 flex flex-wrap items-center gap-3 border-t border-line pt-2.5 text-xs">
                  {(() => {
                    const f = freshness(s)
                    return (
                      <span className={`inline-flex items-center gap-1.5 ${f.tone}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} /> {t(f.labelKey)}
                      </span>
                    )
                  })()}
                  <label className="inline-flex items-center gap-1.5 text-ink-faint">
                    {t('dataSourcesPage.freshnessSlaLabel')}
                    <input
                      key={s.freshness_sla_hours ?? 'none'}
                      type="number"
                      min={1}
                      defaultValue={s.freshness_sla_hours ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        const next = v ? Number(v) : null
                        if (next !== (s.freshness_sla_hours ?? null)) {
                          setSla(s.id, next).catch(() => undefined)
                        }
                      }}
                      placeholder="—"
                      className="w-16 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
              )}

              {openSchema === s.id && (
                <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
                  {schema === null ? (
                    <p className="text-sm text-ink-faint">{t('dataSourcesPage.schemaLoading')}</p>
                  ) : Object.keys(schema).length === 0 ? (
                    <p className="text-sm text-ink-faint">{t('dataSourcesPage.schemaNotFound')}</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(schema).map(([table, cols]) => (
                        <div key={table}>
                          <p className="font-mono text-xs font-medium text-ink">{table}</p>
                          <p className="font-mono text-[11px] text-ink-faint">
                            {cols.map((c) => c.name).join(', ')}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {openProfile === s.id && (
                <div className="mt-3 rounded-xl border border-line bg-surface-2 p-3">
                  <ProfilePanel datasourceId={s.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <input
        ref={refreshInputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        onChange={onRefreshFileChosen}
      />

      <ConnectSourceModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      <ConnectPowerBIModal open={powerbiOpen} onClose={() => setPowerbiOpen(false)} />
      <UploadSourceModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DataPrepModal
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        sources={sources}
        onSaved={() => load().catch(() => undefined)}
      />
      <RlsModal
        open={rlsFor !== null}
        onClose={() => setRlsFor(null)}
        datasourceId={rlsFor?.id ?? null}
        datasourceName={rlsFor?.name ?? ''}
      />
    </div>
  )
}
