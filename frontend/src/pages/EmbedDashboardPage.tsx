import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { DashboardFilterBar } from '../components/dashboard/DashboardFilterBar'
import { PublicWidgetGrid } from '../components/dashboard/PublicWidgetGrid'
import * as branding from '../api/branding'
import * as dashApi from '../api/dashboard'
import type { EmbeddedDashboardView } from '../api/branding'
import { deriveAccentVariants, hexToTriplet } from '../lib/color'
import { mergeFilteredWidgets } from '../store/dashboardStore'
import type { DashboardFilterSpec } from '../types'

/** Layout-less, white-label, read-only embedded dashboard for external apps. */
export function EmbedDashboardPage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()
  const [view, setView] = useState<EmbeddedDashboardView | null>(null)
  const [error, setError] = useState(false)
  const [logoBroken, setLogoBroken] = useState(false)
  // Viewer-side filter — local only, never persisted to the owner's dashboard.
  const [filterSpec, setFilterSpec] = useState<DashboardFilterSpec | null>(null)
  const [filtering, setFiltering] = useState(false)

  const applyFilter = async (spec: DashboardFilterSpec) => {
    if (!token) return
    setFiltering(true)
    try {
      const result = await dashApi.applyPublicFilter(token, spec, 'embed')
      setFilterSpec(result.global_filter)
      setView((v) =>
        v
          ? {
              ...v,
              dashboard: {
                ...v.dashboard,
                widgets: mergeFilteredWidgets(v.dashboard.widgets, result.widgets),
              },
            }
          : v,
      )
    } catch {
      /* interceptor toast */
    } finally {
      setFiltering(false)
    }
  }

  useEffect(() => {
    if (!token) return
    branding
      .getEmbedView(token)
      .then(setView)
      .catch(() => setError(true))
  }, [token])

  // Re-skin the embed with the owner's primary color. Override the full accent set
  // (--accent + press + soft) so nothing stays default emerald, and restore the
  // prior values on unmount so the global <html> style doesn't leak.
  useEffect(() => {
    if (!view) return
    const root = document.documentElement
    const triplet = hexToTriplet(view.brand.primary_color)
    if (!triplet) return
    const vars = { '--accent': triplet } as Record<string, string>
    const variants = deriveAccentVariants(view.brand.primary_color, root.classList.contains('dark'))
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
  }, [view])

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-ink-soft">
        {t('embedDashboardPage.notFoundOrDisabled')}
      </div>
    )
  }
  if (!view) {
    return <div className="grid min-h-screen place-items-center bg-bg text-ink-faint">{t('embedDashboardPage.loading')}</div>
  }

  const { dashboard, brand } = view
  return (
    <div className="min-h-screen bg-bg">
      {/* Publisher's-plate masthead: nameplate → brand-accent rule → serif headline.
          The inner div shares <main>'s max-w-6xl/px-5 column so logo, rule, h1 and
          the chart grid all sit on one left edge. The rule is the single colored
          gesture — it wears the owner's runtime --accent, reading as authorship. */}
      <header className="border-b border-line bg-surface">
        <div className="reveal mx-auto max-w-6xl px-5 pb-3 pt-3">
          <div className="flex items-center justify-between gap-4">
            {brand.logo_url && !logoBroken ? (
              <img
                src={brand.logo_url}
                alt={brand.app_name}
                className="h-8 w-auto max-w-[200px] object-contain object-left"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <span className="min-w-0 truncate font-display text-lg font-semibold tracking-tight text-ink">
                {brand.app_name}
              </span>
            )}
            <span className="shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {t('embedDashboardPage.readOnly')}
            </span>
          </div>
          <div aria-hidden className="mt-1.5 h-0.5 w-10 rounded-full bg-accent" />
          <h1
            title={dashboard.name}
            className="mt-1 truncate font-display text-[22px] font-semibold leading-7 tracking-tight text-ink"
          >
            {dashboard.name}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {dashboard.widgets.length === 0 ? (
          <p className="py-20 text-center text-ink-soft">{t('embedDashboardPage.emptyDashboard')}</p>
        ) : (
          <>
          <DashboardFilterBar
            dashboard={dashboard}
            active={filterSpec}
            busy={filtering}
            onApply={applyFilter}
          />
          <PublicWidgetGrid
            widgets={dashboard.widgets}
            layout={dashboard.layout}
            widgetFallback={t('embedDashboardPage.widget')}
            noResult={t('embedDashboardPage.noResults')}
          />
          </>
        )}
      </main>
    </div>
  )
}
