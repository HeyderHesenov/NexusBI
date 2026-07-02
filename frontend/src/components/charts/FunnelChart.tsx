import { useTranslation } from 'react-i18next'
import { bestTextOn } from '../../lib/color'
import type { FunnelStep } from '../../types'
import { useChartTheme } from './theme'

interface Props {
  steps: FunnelStep[]
}

const W = 640
const BAND_H = 64
const GAP_H = 28
const LABEL_W = 150

/** Funnel chart — hand-rolled SVG trapezoids, SERIES colors, drop-off labels. */
export function FunnelChart({ steps }: Props) {
  const { t } = useTranslation()
  const theme = useChartTheme()

  if (!steps.length) {
    return <p className="text-sm text-ink-soft">{t('cohortPage.empty')}</p>
  }

  const plotW = W - LABEL_W
  // Bar width comes from the backend's pct_of_first, so the printed percentage
  // and the drawn width can never disagree.
  const widthOf = (step: FunnelStep) => Math.max((step.pct_of_first / 100) * plotW, 4)
  const height = steps.length * BAND_H + (steps.length - 1) * GAP_H

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full max-w-2xl text-ink"
      role="img"
      aria-label={t('cohortPage.tabFunnel')}
      data-testid="funnel-chart"
    >
      {steps.map((step, i) => {
        const y = i * (BAND_H + GAP_H)
        const w = widthOf(step)
        const x = LABEL_W + (plotW - w) / 2
        const next = steps[i + 1]
        const nw = next ? widthOf(next) : 0
        const nx = LABEL_W + (plotW - nw) / 2
        const bandColor = theme.SERIES[i % theme.SERIES.length]
        return (
          <g key={step.name}>
            <text x={0} y={y + BAND_H / 2 - 4} fontSize={13} fill="currentColor" fontWeight={600}>
              {t(`cohortPage.step.${step.name}`, { defaultValue: step.name })}
            </text>
            <text x={0} y={y + BAND_H / 2 + 14} fontSize={12} fill={theme.AXIS} className="font-mono">
              {step.count} · {step.pct_of_first}%
            </text>
            <rect x={x} y={y} width={w} height={BAND_H} rx={8} fill={bandColor} />
            {step.count > 0 && w > 60 && (
              <text
                x={x + w / 2}
                y={y + BAND_H / 2 + 5}
                fontSize={14}
                fontWeight={700}
                textAnchor="middle"
                fill={bestTextOn(bandColor)}
              >
                {step.count}
              </text>
            )}
            {next && (
              <>
                <polygon
                  points={`${x},${y + BAND_H} ${x + w},${y + BAND_H} ${nx + nw},${y + BAND_H + GAP_H} ${nx},${y + BAND_H + GAP_H}`}
                  fill={theme.GRID}
                  opacity={0.55}
                />
                <text
                  x={LABEL_W + plotW / 2}
                  y={y + BAND_H + GAP_H / 2 + 4}
                  fontSize={11}
                  textAnchor="middle"
                  fill={theme.AXIS}
                >
                  −{next.drop_pct}%
                </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}
