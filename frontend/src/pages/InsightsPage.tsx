import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Crown, Layers, Search, Sparkles, TriangleAlert, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useInsightStore } from '../store/insightStore'

const KIND_META: Record<string, { Icon: LucideIcon; labelKey: string }> = {
  dominance: { Icon: Crown, labelKey: 'insightsPage.kindDominance' },
  concentration: { Icon: Layers, labelKey: 'insightsPage.kindConcentration' },
  outlier: { Icon: TriangleAlert, labelKey: 'insightsPage.kindOutlier' },
}

export function InsightsPage() {
  const { t } = useTranslation()
  const { items, generating, load, generate, dismiss } = useInsightStore()

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t('insightsPage.eyebrow')}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('insightsPage.title')}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t('insightsPage.subtitle')}
          </p>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
        >
          <Sparkles size={15} className={generating ? 'animate-pulse' : ''} />
          {generating ? t('insightsPage.scanning') : t('insightsPage.discover')}
        </button>
      </header>

      {items.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div>
            <Search size={22} className="mx-auto text-ink-faint" />
            <p className="mt-2 font-display text-lg text-ink">{t('insightsPage.emptyTitle')}</p>
            <p className="mt-1 text-sm text-ink-soft">{t('insightsPage.emptyBody')}</p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((ins) => {
            const meta = KIND_META[ins.kind] ?? { Icon: Sparkles, labelKey: '' }
            const { Icon } = meta
            return (
              <li key={ins.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-ink">{ins.title}</p>
                      <button
                        onClick={() => dismiss(ins.id)}
                        aria-label={t('insightsPage.dismiss')}
                        className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-surface-2 hover:text-ink"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-soft">{ins.body}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{meta.labelKey ? t(meta.labelKey) : ins.kind}</span>
                      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(ins.impact_score * 100)}%` }} />
                      </span>
                      <span className="font-mono text-[10px] text-ink-faint">{t('insightsPage.impact', { score: Math.round(ins.impact_score * 100) })}</span>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
