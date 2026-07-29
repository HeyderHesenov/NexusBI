import { MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { CollabPanel } from '../components/dashboard/CollabPanel'
import { CollabSurface } from '../components/dashboard/CollabSurface'
import { DashboardFilterBar } from '../components/dashboard/DashboardFilterBar'
import { PublicWidgetGrid } from '../components/dashboard/PublicWidgetGrid'
import { NexusMark } from '../components/brand/NexusMark'
import * as dashApi from '../api/dashboard'
import type { BrandConfig } from '../api/branding'
import { deriveAccentVariants, hexToTriplet } from '../lib/color'
import { useCollabStore } from '../store/collabStore'
import { mergeFilteredWidgets } from '../store/dashboardStore'
import type { Dashboard, DashboardFilterSpec } from '../types'

export function PublicDashboardPage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [brand, setBrand] = useState<BrandConfig | null>(null)
  const [logoBroken, setLogoBroken] = useState(false)
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
      .then((v) => {
        setDash(v.dashboard)
        setBrand(v.brand)
      })
      .catch(() => setError(true))
  }, [token])

  // Re-skin the shared page with the owner's primary color (white-label). Override
  // the full accent set so nothing stays default emerald, and restore prior values
  // on unmount so the global <html> style doesn't leak. Default #0E9F6E == the
  // current accent, so non-white-label shared links look unchanged.
  useEffect(() => {
    if (!brand) return
    const root = document.documentElement
    const triplet = hexToTriplet(brand.primary_color)
    if (!triplet) return
    const vars = { '--accent': triplet } as Record<string, string>
    const variants = deriveAccentVariants(brand.primary_color, root.classList.contains('dark'))
    if (variants) {
      vars['--accent-press'] = variants.press
      vars['--accent-soft'] = variants.soft
    }
    const prev = Object.fromEntries(
      Object.keys(vars).map((k) => [k, root.style.getPropertyValue(k)]),
    )
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
    return () => {
      for (const [k, v] of Object.entries(prev)) {
        if (v) root.style.setProperty(k, v)
        else root.style.removeProperty(k)
      }
    }
  }, [brand])

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
      {/* Publisher's-plate masthead — same grammar as the embed page, one notch more
          generous. NexusMark renders only when there is no brand yet (never beside a
          white-label customer's wordmark). The accent rule renders with the lockup so
          the brand signature appears before the dashboard data arrives. */}
      <header className="border-b border-line bg-surface">
        <div className="reveal mx-auto max-w-6xl px-6 pb-4 pt-5">
          <div className="flex items-center justify-between gap-4">
            {brand?.logo_url && !logoBroken ? (
              <img
                src={brand.logo_url}
                alt={brand.app_name}
                className="h-9 w-auto max-w-[240px] object-contain object-left"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <span className="flex min-w-0 items-center gap-2.5">
                {!brand && (
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2">
                    <NexusMark size={20} />
                  </span>
                )}
                <span className="truncate font-display text-xl font-semibold tracking-tight text-ink">
                  {brand ? brand.app_name : 'NexusBI'}
                </span>
              </span>
            )}
            {dash && (
              <div className="flex shrink-0 items-center gap-2">
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
                <span className="whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  {t('publicDashboardPage.readOnly')}
                </span>
              </div>
            )}
          </div>
          <div aria-hidden className="mt-2 h-0.5 w-12 rounded-full bg-accent" />
          {dash && (
            <h1
              title={dash.name}
              className="mt-1.5 truncate font-display text-2xl font-semibold leading-8 tracking-tight text-ink"
            >
              {dash.name}
            </h1>
          )}
        </div>
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
            <PublicWidgetGrid
              widgets={dash.widgets}
              layout={dash.layout}
              widgetFallback={t('publicDashboardPage.widget')}
              noResult={t('publicDashboardPage.noResult')}
            />
          </CollabSurface>
        )}
      </main>

      <CollabPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  )
}
