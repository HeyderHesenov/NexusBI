import { MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { ChartRenderer } from '../components/charts/LazyChartRenderer'
import { CollabPanel } from '../components/dashboard/CollabPanel'
import { CollabSurface } from '../components/dashboard/CollabSurface'
import { DashboardFilterBar } from '../components/dashboard/DashboardFilterBar'
import { NexusMark } from '../components/brand/NexusMark'
import * as dashApi from '../api/dashboard'
import { useCollabStore } from '../store/collabStore'
import { mergeFilteredWidgets } from '../store/dashboardStore'
import type { Dashboard, DashboardFilterSpec } from '../types'

export function PublicDashboardPage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [error, setError] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // Viewer-side filter — local only, never persisted to the owner's dashboard.
  const [filterSpec, setFilterSpec] = useState<DashboardFilterSpec | null>(null)
  const [filtering, setFiltering] = useState(false)
  const { participants, connect, disconnect } = useCollabStore()

  const applyFilter = async (spec: DashboardFilterSpec) => {
    if (!token) return
    setFiltering(true)
    try {
      const result = await dashApi.applyPublicFilter(token, spec)
      setFilterSpec(result.global_filter)
      setDash((d) => (d ? { ...d, widgets: mergeFilteredWidgets(d.widgets, result.widgets) } : d))
    } catch {
      /* interceptor toast */
    } finally {
      setFiltering(false)
    }
  }

  useEffect(() => {
    if (!token) return
    dashApi
      .getPublicDashboard(token)
      .then(setDash)
      .catch(() => setError(true))
  }, [token])

  // Guests join the same collaboration room via the share token.
  const dashId = dash?.id
  useEffect(() => {
    if (!token || !dashId) return
    dashApi
      .getPublicComments(token)
      .then((history) => connect(dashId, { share: token }, history))
      .catch(() => connect(dashId, { share: token }, []))
    return () => disconnect()
  }, [token, dashId, connect, disconnect])

  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center gap-2.5 border-b border-line px-8 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-xl border border-line bg-surface-2">
          <NexusMark size={18} />
        </span>
        <span className="font-display text-base font-bold tracking-tight text-ink">
          Nexus<span className="text-accent">BI</span>
        </span>
        {dash && (
          <>
            <span className="mx-2 h-4 w-px bg-line" />
            <span className="text-sm text-ink-soft">{dash.name}</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setChatOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-ink"
              >
                <MessageCircle size={14} /> {t('publicDashboardPage.team')}
                {participants.length > 1 && (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-bg">
                    {participants.length}
                  </span>
                )}
              </button>
              <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                read-only
              </span>
            </div>
          </>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error ? (
          <p className="py-20 text-center text-ink-soft">{t('publicDashboardPage.notFound')}</p>
        ) : !dash ? (
          <p className="py-20 text-center text-ink-faint">{t('publicDashboardPage.loading')}</p>
        ) : dash.widgets.length === 0 ? (
          <p className="py-20 text-center text-ink-soft">{t('publicDashboardPage.emptyPanel')}</p>
        ) : (
          <CollabSurface>
            <DashboardFilterBar
              dashboard={dash}
              active={filterSpec}
              busy={filtering}
              onApply={applyFilter}
            />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {dash.widgets.map((w) => (
                <div key={w.id} className="flex h-80 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
                  <div className="border-b border-line px-4 py-2.5">
                    <span className="truncate text-sm font-medium text-ink">
                      {w.title || w.chart?.natural_language || t('publicDashboardPage.widget')}
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 p-3">
                    {w.chart && w.chart.data.length ? (
                      <ChartRenderer data={w.chart.data} config={w.chart.chart_config} height="100%" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
                        {t('publicDashboardPage.noResult')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CollabSurface>
        )}
      </main>

      <CollabPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}
