import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Filter, Grid3x3, RefreshCw } from 'lucide-react'
import { useCohortStore } from '../store/cohortStore'
import { CohortHeatmap } from '../components/charts/CohortHeatmap'
import { FunnelChart } from '../components/charts/FunnelChart'

type Tab = 'retention' | 'funnel'

const TABS: { key: Tab; labelKey: string; Icon: typeof Grid3x3 }[] = [
  { key: 'retention', labelKey: 'cohortPage.tabRetention', Icon: Grid3x3 },
  { key: 'funnel', labelKey: 'cohortPage.tabFunnel', Icon: Filter },
]

export function CohortPage() {
  const { t } = useTranslation()
  const { retention, funnel, loading, error, load } = useCohortStore()
  const [tab, setTab] = useState<Tab>('retention')

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t('cohortPage.eyebrow')}</p>
          <div className="mt-1 flex items-center gap-2.5">
            <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
              {t('cohortPage.title')}
            </h1>
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-faint">
              {t('common.demoMode')}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-soft">{t('cohortPage.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
          {TABS.map(({ key, labelKey, Icon }) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                tab === key ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:text-ink'
              }`}
            >
              <Icon size={14} />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-5">
        {loading && !retention ? (
          <div className="grid min-h-[40vh] place-items-center text-sm text-ink-faint">
            {t('common.loading')}
          </div>
        ) : error && !retention ? (
          <div className="grid min-h-[40vh] place-items-center text-center">
            <div>
              <p className="text-sm text-ink-soft">{t('cohortPage.error')}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
              >
                <RefreshCw size={14} />
                {t('common.retry')}
              </button>
            </div>
          </div>
        ) : tab === 'retention' ? (
          <>
            <p className="mb-4 text-xs text-ink-faint">{t('cohortPage.retentionHint')}</p>
            {retention ? (
              <CohortHeatmap data={retention} />
            ) : (
              <p className="text-sm text-ink-soft">{t('cohortPage.empty')}</p>
            )}
          </>
        ) : (
          <>
            <p className="mb-4 text-xs text-ink-faint">{t('cohortPage.funnelHint')}</p>
            <FunnelChart steps={funnel} />
          </>
        )}
      </section>
    </div>
  )
}
