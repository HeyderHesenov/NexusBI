/**
 * The axis color split, asserted on behavior rather than on source text.
 *
 * `theme.contrast.test.ts` scans source and therefore cannot see these: the
 * builders return prop OBJECTS that get spread onto <XAxis>/<YAxis>, so there
 * is no JSX tag for a structural rule to inspect. Since these two functions
 * configure the axes of every Line and Area chart in the product, they are the
 * highest-leverage place for the split to silently collapse back to one color.
 *
 * The split exists because recharts derives tick TEXT from the axis `stroke`
 * (CartesianAxis.renderTicks: `{ …axisProps, stroke: 'none', fill: stroke }`),
 * and the two answer to different WCAG rules: the rule is a graphic at 3:1
 * (AXIS measures 3.24 light / 3.31 dark — passes), the labels are text at 4.5:1
 * (AXIS fails; INK_SOFT measures 5.94–7.21 — passes).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  AngledTick,
  TruncatedTick,
  timeSeriesXAxisProps,
  truncate,
  valueYAxisProps,
} from './axis'

const COLORS = { axis: '#AA0000', inkSoft: '#00BB00' }
const fmt = (n: number) => String(n)

describe('shared axis prop builders keep the rule and the labels apart', () => {
  it('strokes the time-series axis with AXIS but labels it with INK_SOFT', () => {
    const props = timeSeriesXAxisProps(COLORS, 'month', 'Month', false)
    expect(props.stroke).toBe(COLORS.axis)
    expect(props.tick).toEqual({ fontSize: 12, fill: COLORS.inkSoft })
    expect(props.label).toMatchObject({ fill: COLORS.inkSoft })
  })

  it('strokes the value axis with AXIS but labels it with INK_SOFT', () => {
    const props = valueYAxisProps(COLORS, fmt, 'Revenue')
    expect(props.stroke).toBe(COLORS.axis)
    expect(props.tick).toEqual({ fontSize: 12, fill: COLORS.inkSoft })
    expect(props.label).toMatchObject({ fill: COLORS.inkSoft })
  })

  it('never hands the axis color to anything that renders as text', () => {
    // The regression this guards is a one-character edit — `inkSoft` back to
    // `axis` — in a file that would still type-check and still render a chart.
    for (const props of [
      timeSeriesXAxisProps(COLORS, 'month', 'Month', false),
      timeSeriesXAxisProps(COLORS, 'month', null, true),
      valueYAxisProps(COLORS, fmt, 'Revenue'),
      valueYAxisProps(COLORS, fmt, null),
    ]) {
      const text = [props.tick, props.label].filter(
        (v) => v && typeof v === 'object' && 'fill' in v,
      ) as Array<{ fill: unknown }>
      for (const t of text) expect(t.fill).toBe(COLORS.inkSoft)
    }
  })

  it('hands the long-label axis a custom tick element, which owns its color', () => {
    // `longX` swaps the plain object for <TruncatedTick/>. That element reads
    // the theme itself, so the assertion that matters is that it is an element
    // and not an object still carrying a fill — checked by the two tests below.
    const props = timeSeriesXAxisProps(COLORS, 'month', null, true)
    expect(typeof props.tick).toBe('object')
    expect(props.tick).toHaveProperty('type')
  })
})

describe('tick elements render their label in ink, not in the axis color', () => {
  // Light mode is the default in themeStore (localStorage is empty in jsdom),
  // so these assert the light INK_SOFT — the mode where AXIS-as-text was worst.
  const INK_SOFT_LIGHT = '#5B5750'

  it('TruncatedTick', () => {
    render(
      <svg>
        <TruncatedTick x={0} y={0} payload={{ value: 'January' }} />
      </svg>,
    )
    expect(screen.getByText('January')).toHaveAttribute('fill', INK_SOFT_LIGHT)
  })

  it('AngledTick', () => {
    render(
      <svg>
        <AngledTick x={0} y={0} payload={{ value: 'January' }} />
      </svg>,
    )
    expect(screen.getByText('January')).toHaveAttribute('fill', INK_SOFT_LIGHT)
  })

  it('truncates without losing the ink color', () => {
    render(
      <svg>
        <TruncatedTick x={0} y={0} payload={{ value: 'A very long category name' }} max={10} />
      </svg>,
    )
    const el = screen.getByText(truncate('A very long category name', 10))
    expect(el).toHaveAttribute('fill', INK_SOFT_LIGHT)
  })
})
