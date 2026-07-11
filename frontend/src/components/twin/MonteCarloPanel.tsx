import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dices, RotateCcw } from 'lucide-react'
import { formatMetricValue as fmt, formatSignedPct } from '../../lib/format'
import { activeRanges, histogram, monteCarlo, type MonteCarloResult } from '../../lib/twinAnalysis'
import { DANGER, useChartTheme } from '../charts/theme'
import { ChartTip, niceTicks, useChartHover, useMounted } from './chartkit'
import type { LeverRanges } from '../../lib/twinAnalysis'
import type { EvaluatedNode } from '../../types'

interface Props {
  root: EvaluatedNode
  leaves: EvaluatedNode[]
  baseline: number
  ranges: LeverRanges
  onSetRange: (leafId: string, range: { min: number; max: number }) => void
  onClear: () => void
}

const ITERATIONS = 2000

/** Monte Carlo: sample each lever's ± range, run 2000 draws, show the KPI
 *  distribution with P10 / P50 / P90 markers. */
export function MonteCarloPanel({ root, leaves, baseline, ranges, onSetRange, onClear }: Props) {
  const { t } = useTranslation()
  const [result, setResult] = useState<MonteCarloResult | null>(null)

  // Switching KPI leaves a run describing the old tree — clear it so the
  // distribution never mismatches the current baseline.
  useEffect(() => setResult(null), [root.id])

  const active = useMemo(() => activeRanges(leaves, ranges), [leaves, ranges])
  const hasRanges = Object.keys(active).length > 0
  const touched = leaves.some((l) => ranges[l.id])

  const run = () => setResult(monteCarlo(root, active, baseline, { iterations: ITERATIONS, seed: 1 }))

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-card lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <p className="eyebrow">{t('twinPage.monteCarlo.ranges')}</p>
          {touched && (
            <button
              type="button"
              onClick={() => { onClear(); setResult(null) }}
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft transition hover:text-accent"
            >
              <RotateCcw size={12} /> {t('twinPage.reset')}
            </button>
          )}
        </div>
        <p className="mb-4 text-sm text-ink-soft">{t('twinPage.monteCarlo.help', { n: ITERATIONS })}</p>
        <div className="flex flex-col gap-3">
          {leaves.map((leaf) => {
            const r = ranges[leaf.id] ?? { min: 0, max: 0 }
            return (
              <div key={leaf.id} className="rounded-xl border border-line bg-surface-2 p-3">
                <label className="text-sm font-medium text-ink">{leaf.name}</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <RangeInput aria-label={`${leaf.name} ${t('twinPage.monteCarlo.min')}`} value={r.min} onChange={(v) => onSetRange(leaf.id, { min: v, max: r.max })} />
                  <span className="text-xs text-ink-faint">…</span>
                  <RangeInput aria-label={`${leaf.name} ${t('twinPage.monteCarlo.max')}`} value={r.max} onChange={(v) => onSetRange(leaf.id, { min: r.min, max: v })} />
                  <span className="text-xs text-ink-faint">%</span>
                </div>
              </div>
            )
          })}
        </div>
        <button
          type="button"
          onClick={run}
          disabled={!hasRanges}
          className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
        >
          <Dices size={14} /> {t('twinPage.monteCarlo.run', { n: ITERATIONS })}
        </button>
      </section>

      <div className="lg:col-span-3">
        {result === null ? (
          <div className="plot-grid grid h-full min-h-[40vh] place-items-center rounded-2xl border border-dashed border-line px-6 text-center text-sm text-ink-faint">
            {t('twinPage.monteCarlo.empty')}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('twinPage.monteCarlo.p10')} value={result.p10} baseline={baseline} />
              <Stat label={t('twinPage.monteCarlo.p50')} value={result.p50} baseline={baseline} emphasize />
              <Stat label={t('twinPage.monteCarlo.p90')} value={result.p90} baseline={baseline} />
            </div>
            <section className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <p className="eyebrow mb-3">{t('twinPage.monteCarlo.distribution')}</p>
              <Distribution result={result} baseline={baseline} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function RangeInput({
  value, onChange, ...rest
}: { value: number; onChange: (v: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      type="number"
      value={value}
      step={5}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-center font-mono text-sm text-ink focus:border-accent focus:outline-none"
      {...rest}
    />
  )
}

function Stat({ label, value, baseline, emphasize }: { label: string; value: number; baseline: number; emphasize?: boolean }) {
  const delta = baseline ? ((value - baseline) / Math.abs(baseline)) * 100 : null
  return (
    <div className={`rounded-2xl border p-4 ${emphasize ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2'}`}>
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-ink tabular-nums">{fmt(value)}</p>
      {delta !== null && (
        <p className="mt-0.5 font-mono text-xs" style={{ color: delta >= 0 ? undefined : DANGER }}>
          <span className={delta >= 0 ? 'text-accent' : ''}>{formatSignedPct(delta)}</span>
        </p>
      )}
    </div>
  )
}

const HW = 640
const HH = 240
const PAD = 10
const PAD_T = 20
const PAD_B = 28

/** Density area of the KPI outcomes with baseline / P10 / P50 / P90 markers. */
function Distribution({ result, baseline }: { result: MonteCarloResult; baseline: number }) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  const mounted = useMounted()
  const gid = `mc-${useId()}`
  const { ref, tip, move, clear } = useChartHover()

  const bins = useMemo(() => histogram(result.samples, 30), [result])
  const total = result.samples.length || 1
  const maxCount = Math.max(...bins.map((b) => b.count), 1)
  const lo = result.min
  const hi = result.max
  const span = hi - lo || 1
  const plotW = HW - PAD * 2
  const plotH = HH - PAD_T - PAD_B
  const x = (v: number) => PAD + ((v - lo) / span) * plotW
  const yBase = PAD_T + plotH
  const yOf = (c: number) => PAD_T + (1 - c / maxCount) * plotH

  const area = useMemo(() => {
    if (!bins.length) return ''
    const mids = bins.map((b) => ({ mx: (b.x0 + b.x1) / 2, c: b.count }))
    const top = mids.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(m.mx).toFixed(1)},${yOf(m.c).toFixed(1)}`).join(' ')
    return `M${x(mids[0].mx).toFixed(1)},${yBase} ${top.slice(1)} L${x(mids[mids.length - 1].mx).toFixed(1)},${yBase} Z`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bins])
  const stroke = useMemo(() => {
    if (!bins.length) return ''
    return bins.map((b, i) => `${i === 0 ? 'M' : 'L'}${x((b.x0 + b.x1) / 2).toFixed(1)},${yOf(b.count).toFixed(1)}`).join(' ')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bins])

  const marks = [
    { v: baseline, label: t('twinPage.baseline'), color: theme.AXIS, dash: '4 3' },
    { v: result.p10, label: 'P10', color: theme.SERIES[2] },
    { v: result.p50, label: 'P50', color: theme.ACCENT },
    { v: result.p90, label: 'P90', color: theme.SERIES[2] },
  ]
  const ticks = niceTicks(lo, hi, 5)

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={clear}>
      <ChartTip tip={tip} />
      <svg viewBox={`0 0 ${HW} ${HH}`} className="w-full" role="img" aria-label={t('twinPage.monteCarlo.distribution')}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={theme.ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* x ticks */}
        {ticks.map((tk) => (
          <text key={tk} x={x(tk)} y={HH - 8} fontSize={10} textAnchor="middle" fill={theme.AXIS} className="font-mono">{fmt(tk)}</text>
        ))}
        <line x1={PAD} y1={yBase} x2={HW - PAD} y2={yBase} stroke={theme.GRID} />

        {/* density */}
        <g style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateY(8px)', transition: 'opacity .6s ease, transform .6s ease' }}>
          <path d={area} fill={`url(#${gid})`} />
          <path d={stroke} fill="none" stroke={theme.ACCENT} strokeWidth={2} strokeLinejoin="round" />
        </g>

        {/* markers */}
        {marks.map((m) =>
          m.v >= lo && m.v <= hi ? (
            <g key={m.label}>
              <line x1={x(m.v)} y1={PAD_T - 8} x2={x(m.v)} y2={yBase} stroke={m.color} strokeWidth={1.5} strokeDasharray={m.dash} />
              <text x={x(m.v)} y={PAD_T - 11} fontSize={10} textAnchor="middle" fill={m.color} className="font-mono">{m.label}</text>
            </g>
          ) : null,
        )}

        {/* invisible hit areas for per-bin hover */}
        {bins.map((b, i) => (
          <rect
            key={i}
            x={x(b.x0)}
            y={PAD_T}
            width={Math.max(x(b.x1) - x(b.x0), 1)}
            height={plotH}
            fill="transparent"
            onMouseMove={(e) => move(e, (
              <span>
                <span className="font-mono">{fmt(b.x0)}…{fmt(b.x1)}</span> · {Math.round((b.count / total) * 100)}%
              </span>
            ))}
          />
        ))}
      </svg>
    </div>
  )
}
