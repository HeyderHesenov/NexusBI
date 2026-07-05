import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dices, RotateCcw } from 'lucide-react'
import { formatMetricValue as fmt, formatSignedPct } from '../../lib/format'
import { activeRanges, histogram, monteCarlo, type MonteCarloResult } from '../../lib/twinAnalysis'
import { useChartTheme } from '../charts/theme'
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
 * distribution with P10 / P50 / P90 markers. */
export function MonteCarloPanel({ root, leaves, baseline, ranges, onSetRange, onClear }: Props) {
  const { t } = useTranslation()
  const [result, setResult] = useState<MonteCarloResult | null>(null)

  // Switching KPI leaves a run describing the old tree — clear it so the
  // histogram never mismatches the current baseline.
  useEffect(() => setResult(null), [root.id])

  const active = useMemo(() => activeRanges(leaves, ranges), [leaves, ranges])
  const hasRanges = Object.keys(active).length > 0
  const touched = leaves.some((l) => ranges[l.id])

  const run = () => setResult(monteCarlo(root, active, baseline, { iterations: ITERATIONS, seed: 1 }))

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section className="rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <p className="eyebrow">{t('twinPage.monteCarlo.ranges')}</p>
          {touched && (
            <button
              type="button"
              onClick={() => {
                onClear()
                setResult(null)
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-ink-soft transition hover:text-accent"
            >
              <RotateCcw size={12} /> {t('twinPage.reset')}
            </button>
          )}
        </div>
        <p className="mb-4 text-sm text-ink-soft">{t('twinPage.monteCarlo.help')}</p>
        <div className="flex flex-col gap-3">
          {leaves.map((leaf) => {
            const r = ranges[leaf.id] ?? { min: 0, max: 0 }
            return (
              <div key={leaf.id}>
                <label className="text-sm font-medium text-ink">{leaf.name}</label>
                <div className="mt-1 flex items-center gap-2">
                  <RangeInput
                    aria-label={`${leaf.name} ${t('twinPage.monteCarlo.min')}`}
                    value={r.min}
                    onChange={(v) => onSetRange(leaf.id, { min: v, max: r.max })}
                  />
                  <span className="text-xs text-ink-faint">…</span>
                  <RangeInput
                    aria-label={`${leaf.name} ${t('twinPage.monteCarlo.max')}`}
                    value={r.max}
                    onChange={(v) => onSetRange(leaf.id, { min: r.min, max: v })}
                  />
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
          className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
        >
          <Dices size={14} /> {t('twinPage.monteCarlo.run', { n: ITERATIONS })}
        </button>
      </section>

      <div className="lg:col-span-3">
        {result === null ? (
          <div className="grid h-full min-h-[40vh] place-items-center rounded-2xl border border-dashed border-line px-6 text-center text-sm text-ink-faint">
            {t('twinPage.monteCarlo.empty')}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label={t('twinPage.monteCarlo.p10')} value={result.p10} baseline={baseline} />
              <Stat label={t('twinPage.monteCarlo.p50')} value={result.p50} baseline={baseline} emphasize />
              <Stat label={t('twinPage.monteCarlo.p90')} value={result.p90} baseline={baseline} />
            </div>
            <section className="rounded-2xl border border-line bg-surface p-5">
              <p className="eyebrow mb-3">{t('twinPage.monteCarlo.distribution')}</p>
              <Histogram result={result} baseline={baseline} />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function RangeInput({
  value,
  onChange,
  ...rest
}: { value: number; onChange: (v: number) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
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

function Stat({
  label,
  value,
  baseline,
  emphasize,
}: {
  label: string
  value: number
  baseline: number
  emphasize?: boolean
}) {
  const delta = baseline ? ((value - baseline) / Math.abs(baseline)) * 100 : null
  return (
    <div className={`rounded-2xl border p-4 ${emphasize ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
      <p className="text-xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-ink">{fmt(value)}</p>
      {delta !== null && (
        <p className={`mt-0.5 font-mono text-xs ${delta >= 0 ? 'text-accent' : 'text-[#D87C6B]'}`}>
          {formatSignedPct(delta)}
        </p>
      )}
    </div>
  )
}

const HW = 640
const HH = 220
const PAD_B = 24

function Histogram({ result, baseline }: { result: MonteCarloResult; baseline: number }) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  const bins = useMemo(() => histogram(result.samples, 28), [result])
  const maxCount = Math.max(...bins.map((b) => b.count), 1)
  const lo = result.min
  const hi = result.max
  const span = hi - lo || 1
  const px = (v: number) => ((v - lo) / span) * HW
  const marks: { v: number; label: string; color: string; dash?: string }[] = [
    { v: baseline, label: t('twinPage.baseline'), color: theme.AXIS, dash: '4 3' },
    { v: result.p10, label: 'P10', color: theme.SERIES[2] },
    { v: result.p50, label: 'P50', color: theme.ACCENT },
    { v: result.p90, label: 'P90', color: theme.SERIES[2] },
  ]

  return (
    <svg viewBox={`0 0 ${HW} ${HH}`} className="w-full" role="img" aria-label={t('twinPage.monteCarlo.distribution')}>
      {bins.map((b, i) => {
        const h = (b.count / maxCount) * (HH - PAD_B - 20)
        const w = Math.max(px(b.x1) - px(b.x0) - 1.5, 1)
        return (
          <rect
            key={i}
            x={px(b.x0)}
            y={HH - PAD_B - h}
            width={w}
            height={h}
            rx={2}
            fill={theme.ACCENT}
            opacity={0.35}
          />
        )
      })}
      {marks.map((m) =>
        m.v >= lo && m.v <= hi ? (
          <g key={m.label}>
            <line
              x1={px(m.v)}
              y1={4}
              x2={px(m.v)}
              y2={HH - PAD_B}
              stroke={m.color}
              strokeWidth={1.5}
              strokeDasharray={m.dash}
            />
            <text x={px(m.v)} y={HH - 8} fontSize={10} textAnchor="middle" fill={m.color} className="font-mono">
              {m.label}
            </text>
          </g>
        ) : null,
      )}
    </svg>
  )
}
