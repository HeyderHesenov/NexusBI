import { useTranslation } from 'react-i18next'
import { formatMetricValue as fmt, truncateLabel } from '../../lib/format'
import type { WaterfallStep } from '../../lib/metricTreeMath'
import { DANGER, useChartTheme } from '../charts/theme'

const W = 640
const BAR_H = 30
const ROW_GAP = 14
const LABEL_W = 150
const VALUE_GUTTER = 78 // right gutter so the max bar's value label never clips

/**
 * Horizontal waterfall: baseline bar, one delta bar per adjusted leaf
 * (cumulative-sequential, so deltas sum exactly to the final bar), final bar.
 */
export function WaterfallChart({ steps }: { steps: WaterfallStep[] }) {
  const { t } = useTranslation()
  const theme = useChartTheme()

  const values = steps.flatMap((s) => [s.from, s.to, 0])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const plotW = W - LABEL_W - VALUE_GUTTER
  const x = (v: number) => LABEL_W + ((v - min) / span) * plotW
  const height = steps.length * (BAR_H + ROW_GAP)

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full text-ink"
      role="img"
      aria-label={t('twinPage.waterfall')}
      data-testid="waterfall-chart"
    >
      {steps.map((s, i) => {
        const y = i * (BAR_H + ROW_GAP)
        const isEdge = s.kind !== 'delta'
        const from = isEdge ? 0 : s.from
        const to = s.to
        const x0 = Math.min(x(from), x(to))
        const w = Math.max(Math.abs(x(to) - x(from)), 2)
        const delta = s.to - s.from
        const fill = isEdge ? theme.SERIES[5] : delta >= 0 ? theme.ACCENT : DANGER
        const label = s.kind === 'baseline'
          ? t('twinPage.baseline')
          : s.kind === 'final'
            ? t('twinPage.result')
            : s.label
        return (
          <g key={s.id}>
            <text x={0} y={y + BAR_H / 2 + 4} fontSize={12} fill="currentColor">
              {truncateLabel(label)}
            </text>
            <rect x={x0} y={y} width={w} height={BAR_H} rx={6} fill={fill} opacity={isEdge ? 0.85 : 1} />
            <text
              x={x0 + w + 6}
              y={y + BAR_H / 2 + 4}
              fontSize={11}
              fill={theme.AXIS}
              className="font-mono"
            >
              {s.kind === 'delta' ? `${delta >= 0 ? '+' : ''}${fmt(delta)}` : fmt(s.to)}
            </text>
          </g>
        )
      })}
      <line x1={x(0)} y1={0} x2={x(0)} y2={height} stroke={theme.GRID} strokeDasharray="3 3" />
    </svg>
  )
}
