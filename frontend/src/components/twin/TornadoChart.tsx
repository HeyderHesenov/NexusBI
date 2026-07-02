import { useTranslation } from 'react-i18next'
import { formatMetricValue as fmt, truncateLabel } from '../../lib/format'
import type { SensitivityRow } from '../../lib/metricTreeMath'
import { DANGER, useChartTheme } from '../charts/theme'

const W = 640
const BAR_H = 22
const ROW_GAP = 12
const LABEL_W = 150
const VALUE_GUTTER = 78 // right gutter — the ±value label must not sit on a bar

/** Tornado chart: per-leaf ±10% impact on the root KPI, largest first. */
export function TornadoChart({ rows, pct }: { rows: SensitivityRow[]; pct: number }) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  if (!rows.length) return null

  const maxAbs = Math.max(...rows.flatMap((r) => [Math.abs(r.up), Math.abs(r.down)]), 1e-9)
  const plotW = W - LABEL_W - VALUE_GUTTER
  const cx = LABEL_W + plotW / 2
  const scale = (v: number) => (v / maxAbs) * (plotW / 2)
  const height = rows.length * (BAR_H + ROW_GAP)

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full text-ink"
      role="img"
      aria-label={t('twinPage.tornado', { pct })}
      data-testid="tornado-chart"
    >
      {rows.map((r, i) => {
        const y = i * (BAR_H + ROW_GAP)
        const upW = scale(r.up)
        const downW = scale(r.down)
        return (
          <g key={r.id}>
            <text x={0} y={y + BAR_H / 2 + 4} fontSize={12} fill="currentColor">
              {truncateLabel(r.name)}
            </text>
            {/* −pct effect */}
            <rect
              x={downW >= 0 ? cx : cx + downW}
              y={y}
              width={Math.max(Math.abs(downW), 1)}
              height={BAR_H}
              rx={4}
              fill={DANGER}
              opacity={0.75}
            />
            {/* +pct effect */}
            <rect
              x={upW >= 0 ? cx : cx + upW}
              y={y}
              width={Math.max(Math.abs(upW), 1)}
              height={BAR_H}
              rx={4}
              fill={theme.ACCENT}
              opacity={0.9}
            />
            <text x={W - 2} y={y + BAR_H / 2 + 4} fontSize={11} textAnchor="end" fill={theme.AXIS} className="font-mono">
              ±{fmt(Math.max(Math.abs(r.up), Math.abs(r.down)))}
            </text>
          </g>
        )
      })}
      <line x1={cx} y1={0} x2={cx} y2={height} stroke={theme.GRID} />
    </svg>
  )
}
