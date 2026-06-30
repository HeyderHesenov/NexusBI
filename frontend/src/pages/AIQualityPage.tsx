import { useEffect } from 'react'
import { Activity, Database, Gauge, PlayCircle, RefreshCw, Sparkles } from 'lucide-react'
import { useAIQualityStore } from '../store/aiQualityStore'

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
  const { runs, obs, busy, load, runEval, reindex } = useAIQualityStore()

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
  const TIER_LABEL: Record<string, string> = { easy: 'Asan', medium: 'Orta', hard: 'Çətin' }
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
          <p className="eyebrow">AI Mühəndisliyi</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">AI Keyfiyyət</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Text2SQL dəqiqliyi, gecikmə, token istifadəsi və RAG əsaslandırması — app öz AI-ını ölçür.
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            ⚠ Demo schema üzərində səviyyələnmiş golden dəsti (bare engine) — reqressiya siqnalı,
            mütləq real-dünya Text2SQL dəqiqliyi deyil.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reindex}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <RefreshCw size={15} /> Yenidən indekslə
          </button>
          <button
            onClick={() => runEval(true)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl border border-accent px-3 py-2 text-sm font-semibold text-accent transition hover:bg-accent-soft disabled:opacity-60"
          >
            <Sparkles size={15} /> Grounded (RAG)
          </button>
          <button
            onClick={() => runEval(false)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-60"
          >
            <PlayCircle size={15} /> {busy ? 'İşləyir…' : 'Eval işlət'}
          </button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Gauge size={12} />}
          label="Text2SQL dəqiqliyi"
          value={latest ? `${Math.round(latest.exec_accuracy * 100)}%` : '—'}
          hint={latest ? `${latest.passed}/${latest.total} golden keçdi` : 'Hələ eval yoxdur'}
        />
        <StatCard
          icon={<Activity size={12} />}
          label="Orta gecikmə"
          value={obs ? `${obs.avg_latency_ms} ms` : '—'}
          hint={obs ? `${obs.calls} AI çağırışı` : undefined}
        />
        <StatCard
          icon={<Sparkles size={12} />}
          label="Token istifadəsi"
          value={obs ? Intl.NumberFormat('az', { notation: 'compact' }).format(obs.total_tokens) : '—'}
          hint="cari sessiya"
        />
        <StatCard
          icon={<Database size={12} />}
          label="Çağırış növləri"
          value={obs ? String(Object.keys(obs.by_kind).length) : '—'}
          hint={obs ? Object.entries(obs.by_kind).map(([k, v]) => `${k}:${v}`).join(' · ') : undefined}
        />
      </div>

      {(latestBare || latestGrounded) && (
        <div className="mt-3 flex flex-wrap items-stretch gap-2">
          <div className="rounded-xl border border-line bg-surface px-3 py-2">
            <span className="eyebrow">Bare engine</span>
            <span className="ml-2 font-mono text-ink">
              {latestBare ? `${Math.round(latestBare.exec_accuracy * 100)}%` : '—'}
            </span>
          </div>
          <div className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-2">
            <span className="eyebrow text-accent">Grounded (RAG)</span>
            <span className="ml-2 font-mono text-ink">
              {latestGrounded ? `${Math.round(latestGrounded.exec_accuracy * 100)}%` : '—'}
            </span>
          </div>
          {ragDelta != null && (
            <div className="flex items-center rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <span className="eyebrow">RAG təsiri</span>
              <span className={`ml-2 font-mono ${ragDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {ragDelta > 0 ? '+' : ''}{ragDelta}%
              </span>
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
          <p className="eyebrow mb-2">Dəqiqlik trendi</p>
          {trend.length >= 2 ? (
            <Trend values={trend} />
          ) : (
            <p className="text-sm text-ink-faint">Trend üçün ən azı 2 eval lazımdır.</p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="eyebrow mb-2">Son eval-lar</p>
          {runs.length === 0 ? (
            <p className="text-sm text-ink-faint">Hələ eval işlədilməyib.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {runs.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span
                      className={`rounded px-1 text-[10px] uppercase ${
                        r.mode === 'grounded' ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-faint'
                      }`}
                    >
                      {r.mode === 'grounded' ? 'RAG' : 'bare'}
                    </span>
                    <span className="font-mono text-ink-soft">{new Date(r.created_at).toLocaleString('az')}</span>
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
            <p className="eyebrow">Son eval — sual üzrə nəticə</p>
            <p className="text-xs text-ink-faint">✓ = nəticə uyğun · ⚑ = sütun adı da eyni</p>
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
