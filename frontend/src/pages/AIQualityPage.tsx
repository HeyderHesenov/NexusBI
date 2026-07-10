import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Database, Gauge, HelpCircle, PlayCircle, RefreshCw, Sparkles } from 'lucide-react'
import { useAIQualityStore } from '../store/aiQualityStore'
import { formatNumber } from '../lib/format'
import { useFormatDate } from '../hooks/useFormatDate'

function Trend({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 220
  const h = 44
  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - Math.max(0, Math.min(1, v)) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke="#10B981" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="eyebrow flex items-center gap-1.5">{icon} {label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-ink">{value}</p>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}

export function AIQualityPage() {
  const { t } = useTranslation()
  const fmtDate = useFormatDate()
  const { runs, obs, busy, load, runEval, runHistory, reindex } = useAIQualityStore()
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  const latest = runs[0]
  // Oldest → newest for the trend line.
  const trend = [...runs].reverse().map((r) => r.exec_accuracy)

  const latestBare = runs.find((r) => r.mode === 'bare')
  const latestGrounded = runs.find((r) => r.mode === 'grounded')
  const ragDelta =
    latestBare && latestGrounded
      ? Math.round((latestGrounded.exec_accuracy - latestBare.exec_accuracy) * 100)
      : null

  const TIERS = ['easy', 'medium', 'hard'] as const
  const TIER_LABEL: Record<string, string> = {
    easy: t('aIQualityPage.tierEasy'),
    medium: t('aIQualityPage.tierMedium'),
    hard: t('aIQualityPage.tierHard'),
    history: t('aIQualityPage.tierHistory'),
  }
  const latestHistory = runs.find((r) => r.mode === 'history')
  const tierStats = latest
    ? TIERS.map((t) => {
        const cases = latest.details.filter((d) => d.tier === t)
        return { t, pass: cases.filter((d) => d.passed).length, total: cases.length }
      }).filter((s) => s.total > 0)
    : []

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('aIQualityPage.eyebrow')}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('aIQualityPage.title')}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t('aIQualityPage.subtitle')}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {t('aIQualityPage.disclaimer')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowHelp((v) => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition ${
              showHelp ? 'border-accent text-accent' : 'border-line text-ink-soft hover:border-accent hover:text-accent'
            }`}
          >
            <HelpCircle size={15} /> {t('aIQualityPage.howItWorks')}
          </button>
          <button
            onClick={reindex}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <RefreshCw size={15} /> {t('aIQualityPage.reindex')}
          </button>
          <button
            onClick={runHistory}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <Activity size={15} /> {t('aIQualityPage.historyRegression')}
          </button>
          <button
            onClick={() => runEval(true)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-accent px-3 py-2 text-sm font-semibold text-accent transition hover:bg-accent-soft disabled:opacity-60"
          >
            <Sparkles size={15} /> {t('aIQualityPage.grounded')}
          </button>
          <button
            onClick={() => runEval(false)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-60"
          >
            <PlayCircle size={15} /> {busy ? t('aIQualityPage.running') : t('aIQualityPage.runEval')}
          </button>
        </div>
      </header>

      {showHelp && (
        <div className="mb-4 rounded-2xl border border-line bg-surface p-5 text-sm leading-relaxed">
          <p className="eyebrow mb-2">{t('aIQualityPage.howItWorks')}</p>
          <p className="text-ink-soft">
            {t('aIQualityPage.helpIntro')}
          </p>

          <p className="eyebrow mt-4 mb-1">{t('aIQualityPage.helpButtonsTitle')}</p>
          <ul className="space-y-1 text-ink-soft">
            <li><span className="font-semibold text-ink">{t('aIQualityPage.runEval')}</span> — {t('aIQualityPage.helpRunEval')}</li>
            <li><span className="font-semibold text-accent">{t('aIQualityPage.grounded')}</span> — {t('aIQualityPage.helpGrounded')}</li>
            <li><span className="font-semibold text-ink">{t('aIQualityPage.historyRegression')}</span> — {t('aIQualityPage.helpHistory')}</li>
            <li><span className="font-semibold text-ink">{t('aIQualityPage.reindex')}</span> — {t('aIQualityPage.helpReindex')}</li>
          </ul>

          <p className="eyebrow mt-4 mb-1">{t('aIQualityPage.helpReadNumbersTitle')}</p>
          <p className="text-ink-soft">
            {t('aIQualityPage.helpReadNumbers')}
          </p>

          <p className="eyebrow mt-4 mb-1">{t('aIQualityPage.helpWorkflowTitle')}</p>
          <p className="text-ink-soft">
            {t('aIQualityPage.helpWorkflow')}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Gauge size={12} />}
          label={t('aIQualityPage.statAccuracyLabel')}
          value={latest ? `${Math.round(latest.exec_accuracy * 100)}%` : '—'}
          hint={latest ? t('aIQualityPage.statAccuracyHint', { passed: latest.passed, total: latest.total }) : t('aIQualityPage.statAccuracyEmpty')}
        />
        <StatCard
          icon={<Activity size={12} />}
          label={t('aIQualityPage.statLatencyLabel')}
          value={obs ? `${obs.avg_latency_ms} ms` : '—'}
          hint={obs ? t('aIQualityPage.statLatencyHint', { calls: obs.calls }) : undefined}
        />
        <StatCard
          icon={<Sparkles size={12} />}
          label={t('aIQualityPage.statTokensLabel')}
          value={obs ? formatNumber(obs.total_tokens, { compact: true }) : '—'}
          hint={t('aIQualityPage.statTokensHint')}
        />
        <StatCard
          icon={<Database size={12} />}
          label={t('aIQualityPage.statCallTypesLabel')}
          value={obs ? String(Object.keys(obs.by_kind).length) : '—'}
          hint={obs ? Object.entries(obs.by_kind).map(([k, v]) => `${k}:${v}`).join(' · ') : undefined}
        />
      </div>

      {(latestBare || latestGrounded || latestHistory) && (
        <div className="mt-3 flex flex-wrap items-stretch gap-2">
          <div className="rounded-xl border border-line bg-surface px-3 py-2">
            <span className="eyebrow">{t('aIQualityPage.bareEngine')}</span>
            <span className="ml-2 font-mono text-ink">
              {latestBare ? `${Math.round(latestBare.exec_accuracy * 100)}%` : '—'}
            </span>
          </div>
          <div className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-2">
            <span className="eyebrow text-accent">{t('aIQualityPage.grounded')}</span>
            <span className="ml-2 font-mono text-ink">
              {latestGrounded ? `${Math.round(latestGrounded.exec_accuracy * 100)}%` : '—'}
            </span>
          </div>
          {ragDelta != null && (
            <div className="flex items-center rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <span className="eyebrow">{t('aIQualityPage.ragImpact')}</span>
              <span className={`ml-2 font-mono ${ragDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {ragDelta > 0 ? '+' : ''}{ragDelta}%
              </span>
            </div>
          )}
          {latestHistory && (
            <div className="rounded-xl border border-line bg-surface px-3 py-2" title={t('aIQualityPage.historyStabilityTooltip')}>
              <span className="eyebrow">{t('aIQualityPage.historyStability')}</span>
              <span className="ml-2 font-mono text-ink">
                {Math.round(latestHistory.exec_accuracy * 100)}%
              </span>
              <span className="ml-1 text-xs text-ink-faint">({latestHistory.passed}/{latestHistory.total})</span>
            </div>
          )}
        </div>
      )}

      {tierStats.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {tierStats.map((s) => (
            <div key={s.t} className="rounded-xl border border-line bg-surface px-3 py-2">
              <span className="eyebrow">{TIER_LABEL[s.t]}</span>
              <span className="ml-2 font-mono text-ink">
                {Math.round((s.pass / s.total) * 100)}%
              </span>
              <span className="ml-1 text-xs text-ink-faint">({s.pass}/{s.total})</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="eyebrow mb-2">{t('aIQualityPage.accuracyTrend')}</p>
          {trend.length >= 2 ? (
            <Trend values={trend} />
          ) : (
            <p className="text-sm text-ink-faint">{t('aIQualityPage.trendEmpty')}</p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="eyebrow mb-2">{t('aIQualityPage.recentEvals')}</p>
          {runs.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('aIQualityPage.recentEvalsEmpty')}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {runs.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded px-1 text-[10px] uppercase ${
                        r.mode === 'grounded'
                          ? 'bg-accent-soft text-accent'
                          : r.mode === 'history'
                            ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-surface-2 text-ink-faint'
                      }`}
                    >
                      {r.mode === 'grounded' ? 'RAG' : r.mode === 'history' ? t('aIQualityPage.modeHistory') : 'bare'}
                    </span>
                    <span className="font-mono text-ink-soft">{fmtDate(r.created_at)}</span>
                  </span>
                  <span className="font-mono text-ink">
                    {r.passed}/{r.total} · {Math.round(r.exec_accuracy * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {latest && latest.details.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">{t('aIQualityPage.perCaseTitle')}</p>
            <p className="text-xs text-ink-faint">{t('aIQualityPage.perCaseLegend')}</p>
          </div>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {latest.details.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={d.passed ? 'text-emerald-400' : 'text-red-400'}>
                  {d.passed ? '✓' : '✗'}
                </span>
                <span
                  className={`shrink-0 rounded px-1 text-[10px] uppercase ${
                    d.tier === 'hard'
                      ? 'bg-red-500/10 text-red-400'
                      : d.tier === 'medium'
                        ? 'bg-amber-500/10 text-amber-400'
                        : 'bg-surface-2 text-ink-faint'
                  }`}
                >
                  {TIER_LABEL[d.tier]}
                </span>
                <span className="truncate text-ink-soft">{d.nl}</span>
                {d.passed && d.strict_passed && <span className="text-ink-faint">⚑</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
