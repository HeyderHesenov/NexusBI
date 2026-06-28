import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ChartRenderer } from '../components/charts/ChartRenderer'
import * as branding from '../api/branding'
import type { EmbeddedDashboardView } from '../api/branding'

/** Apply a white-label primary color by overriding the --accent CSS triplet. */
function hexToTriplet(hex: string): string | null {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim())
  if (!m) return null
  return `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}`
}

/** Layout-less, white-label, read-only embedded dashboard for external apps. */
export function EmbedDashboardPage() {
  const { token } = useParams<{ token: string }>()
  const [view, setView] = useState<EmbeddedDashboardView | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!token) return
    branding
      .getEmbedView(token)
      .then(setView)
      .catch(() => setError(true))
  }, [token])

  // Brand the embed: app name + primary color.
  useEffect(() => {
    if (!view) return
    const triplet = hexToTriplet(view.brand.primary_color)
    if (triplet) document.documentElement.style.setProperty('--accent', triplet)
  }, [view])

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-ink-soft">
        Embed tapılmadı və ya söndürülüb.
      </div>
    )
  }
  if (!view) {
    return <div className="grid min-h-screen place-items-center bg-bg text-ink-faint">Yüklənir…</div>
  }

  const { dashboard, brand } = view
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center gap-2.5 border-b border-line px-6 py-3">
        {brand.logo_url ? (
          <img src={brand.logo_url} alt={brand.app_name} className="h-6 w-auto" />
        ) : (
          <span className="font-display text-base font-bold tracking-tight text-ink">
            {brand.app_name}
          </span>
        )}
        <span className="mx-2 h-4 w-px bg-line" />
        <span className="text-sm text-ink-soft">{dashboard.name}</span>
        <span className="ml-auto rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
          read-only
        </span>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        {dashboard.widgets.length === 0 ? (
          <p className="py-20 text-center text-ink-soft">Bu panel boşdur.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {dashboard.widgets.map((w) => (
              <div
                key={w.id}
                className="flex h-80 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
              >
                <div className="border-b border-line px-4 py-2.5">
                  <span className="truncate text-sm font-medium text-ink">
                    {w.title || w.chart?.natural_language || 'Widget'}
                  </span>
                </div>
                <div className="min-h-0 flex-1 p-3">
                  {w.chart && w.chart.data.length ? (
                    <ChartRenderer data={w.chart.data} config={w.chart.chart_config} height="100%" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-ink-faint">
                      Nəticə yoxdur.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
