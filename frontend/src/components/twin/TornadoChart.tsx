import { useTranslation } from 'react-i18next'
import { formatMetricValue as fmt, truncateLabel } from '../../lib/format'
import type { SensitivityRow } from '../../lib/metricTreeMath'
import { DANGER, useChartTheme } from '../charts/theme'
import { ChartTip, niceTicks, useChartHover, useMounted } from './chartkit'

const W = 600
const LABEL_W = 150
const PAD_R = 18
const ROW = 32
const BAR_H = 16
const TOP = 8
const AXIS_H = 26

/** Tornado: per-leaf ±pct impact on the KPI, largest first — a diverging bar
 *  (danger on the down side, accent on the up side) over a real value axis. */
export function TornadoChart({ rows, pct }: { rows: SensitivityRow[]; pct: number }) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  const mounted = useMounted()
  const { ref, tip, move, clear } = useChartHover()
  if (!rows.length) return null

  const plotW = W - LABEL_W - PAD_R
  const cx = LABEL_W + plotW / 2
  const maxAbs = Math.max(...rows.flatMap((r) => [Math.abs(r.up), Math.abs(r.down)]), 1e-9)
  const scale = (v: number) => (v / maxAbs) * (plotW / 2)
  const rowsH = rows.length * ROW
  const H = TOP + rowsH + AXIS_H
  const ticks = niceTicks(-maxAbs, maxAbs, 4)

  return (
    <div ref={ref} className="relative w-full" onMouseLeave={clear}>
      <ChartTip tip={tip} />
      {/* legend */}
      <div className="mb-2 flex items-center gap-4 text-xs text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: theme.ACCENT }} /> +{pct}%
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DANGER }} /> −{pct}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('twinPage.tornado', { pct })} data-testid="tornado-chart">
        {/* value grid + ticks */}
        {ticks.map((tk) => {
          const x = cx + scale(tk)
          return (
            <g key={tk}>
              <line x1={x} y1={TOP} x2={x} y2={TOP + rowsH} stroke={theme.GRID} strokeDasharray="2 4" opacity={tk === 0 ? 0 : 1} />
              <text x={x} y={H - 8} fontSize={10} textAnchor="middle" fill={theme.AXIS} className="font-mono">
                {fmt(tk)}
              </text>
            </g>
          )
        })}
        {/* zero axis */}
        <line x1={cx} y1={TOP} x2={cx} y2={TOP + rowsH} stroke={theme.AXIS} strokeWidth={1} opacity={0.6} />

        {rows.map((r, i) => {
          const y = TOP + i * ROW + (ROW - BAR_H) / 2
          const right = Math.max(0, r.up, r.down)
          const left = Math.min(0, r.up, r.down)
          const rW = Math.abs(scale(right))
          const lW = Math.abs(scale(left))
          const peak = fmt(Math.max(Math.abs(r.up), Math.abs(r.down)))
          const onMove = (e: React.MouseEvent) =>
            move(e, (
              <span>
                <b>{r.name}</b> · <span style={{ color: theme.ACCENT }} className="font-mono">+{fmt(r.up)}</span>{' '}
                <span style={{ color: DANGER }} className="font-mono">{fmt(r.down)}</span>
              </span>
            ))
          return (
            <g key={r.id} onMouseMove={onMove}>
              <text x={0} y={y + BAR_H / 2 + 4} fontSize={12} fill="currentColor" className="text-ink">
                {truncateLabel(r.name, 20)}
              </text>
              {/* down side (danger) */}
              <rect
                x={cx - lW}
                y={y}
                width={Math.max(lW, left < 0 ? 1 : 0)}
                height={BAR_H}
                rx={3}
                fill={DANGER}
                style={{
                  transformBox: 'fill-box', transformOrigin: 'right center',
                  transform: mounted ? 'scaleX(1)' : 'scaleX(0)',
                  transition: `transform .5s cubic-bezier(.22,.61,.36,1) ${i * 45}ms`,
                }}
              />
              {/* up side (accent) */}
              <rect
                x={cx}
                y={y}
                width={Math.max(rW, right > 0 ? 1 : 0)}
                height={BAR_H}
                rx={3}
                fill={theme.ACCENT}
                style={{
                  transformBox: 'fill-box', transformOrigin: 'left center',
                  transform: mounted ? 'scaleX(1)' : 'scaleX(0)',
                  transition: `transform .5s cubic-bezier(.22,.61,.36,1) ${i * 45}ms`,
                }}
              />
              <text x={W - 2} y={y + BAR_H / 2 + 4} fontSize={11} textAnchor="end" fill={theme.AXIS} className="font-mono">
                ±{peak}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
