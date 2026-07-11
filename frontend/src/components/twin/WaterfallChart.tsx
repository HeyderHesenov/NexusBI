import { useTranslation } from 'react-i18next'
import { formatMetricValue as fmt, truncateLabel } from '../../lib/format'
import type { WaterfallStep } from '../../lib/metricTreeMath'
import { DANGER, useChartTheme } from '../charts/theme'
import { ChartTip, niceTicks, useChartHover, useMounted } from './chartkit'

const H = 300
const PAD_L = 54
const PAD_R = 14
const PAD_T = 20
const PAD_B = 40

/**
 * Vertical waterfall: a baseline column, one floating column per adjusted leaf
 * (cumulative-sequential, so the deltas sum exactly to the final column), and a
 * final column — linked by connector lines, over a real value axis. Bars grow in
 * on mount and reveal their step on hover.
 */
export function WaterfallChart({ steps }: { steps: WaterfallStep[] }) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  const mounted = useMounted()
  const { ref, tip, move, clear } = useChartHover()

  const W = Math.max(560, steps.length * 84)
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const vals = steps.flatMap((s) => [s.from, s.to])
  const dmin = Math.min(0, ...vals)
  const dmax = Math.max(0, ...vals)
  const y = (v: number) => PAD_T + ((dmax - v) / (dmax - dmin || 1)) * plotH
  const band = plotW / steps.length
  const bw = Math.min(52, band * 0.62)
  const cx = (i: number) => PAD_L + (i + 0.5) * band
  const ticks = niceTicks(dmin, dmax, 4)

  const labelFor = (s: WaterfallStep) =>
    s.kind === 'baseline' ? t('twinPage.baseline') : s.kind === 'final' ? t('twinPage.result') : s.label

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={clear}>
      <ChartTip tip={tip} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('twinPage.waterfall')} data-testid="waterfall-chart">
        {/* value axis: gridlines + ticks */}
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={PAD_L} y1={y(tk)} x2={W - PAD_R} y2={y(tk)} stroke={theme.GRID} strokeDasharray="2 4" />
            <text x={PAD_L - 8} y={y(tk) + 4} fontSize={11} textAnchor="end" fill={theme.AXIS} className="font-mono">
              {fmt(tk)}
            </text>
          </g>
        ))}

        {/* connectors between consecutive columns (at the shared cumulative level) */}
        {steps.slice(0, -1).map((s, i) => (
          <line
            key={`c-${s.id}`}
            x1={cx(i) + bw / 2}
            y1={y(s.to)}
            x2={cx(i + 1) - bw / 2}
            y2={y(s.to)}
            stroke={theme.AXIS}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.5}
          />
        ))}

        {/* columns */}
        {steps.map((s, i) => {
          const isEdge = s.kind !== 'delta'
          const from = isEdge ? 0 : s.from
          const top = Math.min(y(from), y(s.to))
          const h = Math.max(Math.abs(y(s.to) - y(from)), 2)
          const delta = s.to - s.from
          const fill = isEdge ? theme.SERIES[5] : delta >= 0 ? theme.ACCENT : DANGER
          const x0 = cx(i) - bw / 2
          const valLabel = s.kind === 'delta' ? `${delta >= 0 ? '+' : ''}${fmt(delta)}` : fmt(s.to)
          return (
            <g
              key={s.id}
              onMouseMove={(e) =>
                move(e, (
                  <span>
                    <b>{labelFor(s)}</b> · <span className="font-mono">{s.kind === 'delta' ? valLabel : fmt(s.to)}</span>
                  </span>
                ))
              }
            >
              <rect
                x={x0}
                y={top}
                width={bw}
                height={h}
                rx={5}
                fill={fill}
                opacity={isEdge ? 0.9 : 1}
                style={{
                  transformBox: 'fill-box',
                  transformOrigin: 'center bottom',
                  transform: mounted ? 'scaleY(1)' : 'scaleY(0)',
                  transition: `transform .55s cubic-bezier(.22,.61,.36,1) ${i * 55}ms`,
                }}
              />
              <text x={cx(i)} y={top - 6} fontSize={11} textAnchor="middle" fill={theme.AXIS} className="font-mono">
                {valLabel}
              </text>
              <text x={cx(i)} y={H - PAD_B + 16} fontSize={11} textAnchor="middle" fill="currentColor" className="text-ink-soft">
                {truncateLabel(labelFor(s), 10)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
