import { useTranslation } from 'react-i18next'
import { truncateLabel } from '../../lib/format'
import { DANGER, SERIES, useChartTheme } from '../charts/theme'
import type { BABcgItem, BAContent } from '../../types'

const W = 640
const H = 400
const PAD = { top: 24, right: 24, bottom: 40, left: 48 }

const QUAD_COLOR: Record<BABcgItem['quadrant'], string> = {
  star: SERIES[0], // emerald
  cash_cow: SERIES[3], // tan
  question: SERIES[2], // dusty blue
  dog: DANGER,
}

/** Hand-rolled BCG scatter (SVG): x = revenue share, y = H2-vs-H1 growth,
 * quadrant threshold lines, bubble radius ∝ share. No recharts — this page
 * shouldn't pull the whole charts chunk for one plot. */
export function BCGMatrix({ content }: { content: BAContent }) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  const items = content.items ?? []
  const thr = content.thresholds ?? { share_pct: 0, growth_pct: 0 }
  if (!items.length) return null

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  // Floor guards an all-zero-share payload (NaN would hit the SVG attributes).
  const maxShare = Math.max(...items.map((i) => i.share_pct), thr.share_pct, 0.1) * 1.15
  const maxAbsGrowth =
    Math.max(...items.map((i) => Math.abs(i.growth_pct)), Math.abs(thr.growth_pct), 1) * 1.3
  const x = (share: number) => PAD.left + (share / maxShare) * plotW
  const y = (growth: number) => PAD.top + plotH / 2 - (growth / maxAbsGrowth) * (plotH / 2)

  return (
    <div data-testid="bcg-matrix">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-ink" role="img" aria-label={t('baStudio.fw_bcg')}>
        {/* threshold cross */}
        <line x1={x(thr.share_pct)} y1={PAD.top} x2={x(thr.share_pct)} y2={PAD.top + plotH} stroke={theme.GRID} strokeDasharray="4 4" />
        <line x1={PAD.left} y1={y(thr.growth_pct)} x2={PAD.left + plotW} y2={y(thr.growth_pct)} stroke={theme.GRID} strokeDasharray="4 4" />
        {/* quadrant captions */}
        <text x={PAD.left + plotW - 4} y={PAD.top + 12} textAnchor="end" fontSize={10} fill={theme.AXIS}>{t('baStudio.q_star')}</text>
        <text x={PAD.left + 4} y={PAD.top + 12} fontSize={10} fill={theme.AXIS}>{t('baStudio.q_question')}</text>
        <text x={PAD.left + plotW - 4} y={PAD.top + plotH - 6} textAnchor="end" fontSize={10} fill={theme.AXIS}>{t('baStudio.q_cash_cow')}</text>
        <text x={PAD.left + 4} y={PAD.top + plotH - 6} fontSize={10} fill={theme.AXIS}>{t('baStudio.q_dog')}</text>
        {/* axes labels */}
        <text x={PAD.left + plotW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={theme.AXIS}>{t('baStudio.axisShare')}</text>
        <text x={14} y={PAD.top + plotH / 2} textAnchor="middle" fontSize={11} fill={theme.AXIS} transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}>{t('baStudio.axisGrowth')}</text>
        {items.map((it) => {
          const cx = x(it.share_pct)
          const cy = y(it.growth_pct)
          const r = 8 + (it.share_pct / maxShare) * 22
          const color = QUAD_COLOR[it.quadrant] ?? theme.ACCENT
          return (
            <g key={it.label}>
              <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.35} />
              <circle cx={cx} cy={cy} r={3} fill={color} />
              <text x={cx} y={cy - r - 4} textAnchor="middle" fontSize={11} fill="currentColor">
                {truncateLabel(it.label, 16)}
              </text>
            </g>
          )
        })}
      </svg>
      <ul className="mt-3 grid gap-1.5 text-xs text-ink-soft sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.label} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: QUAD_COLOR[it.quadrant] }} />
            <span className="font-medium text-ink">{it.label}</span>
            <span className="font-mono">
              {t(`baStudio.q_${it.quadrant}`)} · {it.share_pct}% · {it.growth_pct > 0 ? '+' : ''}{it.growth_pct}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
