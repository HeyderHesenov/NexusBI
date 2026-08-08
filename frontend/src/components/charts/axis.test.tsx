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
import { TruncatedTick, axisTickProps, timeSeriesXAxisProps, truncate, valueYAxisProps } from './axis'
import { chartTheme } from './theme'

const COLORS = { axis: '#AA0000', inkSoft: '#00BB00' }
const fmt = (n: number) => String(n)

describe('axisTickProps', () => {
  it('puts the ink color on `fill`, which is the key recharts reads', () => {
    expect(axisTickProps('#00BB00')).toEqual({ fontSize: 12, fill: '#00BB00' })
  })

  it('carries the caller’s font size', () => {
    expect(axisTickProps('#00BB00', 11)).toEqual({ fontSize: 11, fill: '#00BB00' })
  })
})

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
    //
    // The `fill`-bearing values are counted, not just filtered: an earlier
    // version of this loop selected objects that already had a `fill` key, so
    // renaming the key emptied the selection and the body never ran. A filter
    // with no floor under it asserts nothing on exactly the inputs that broke.
    const cases = [
      timeSeriesXAxisProps(COLORS, 'month', 'Month', false),
      timeSeriesXAxisProps(COLORS, 'month', null, true),
      valueYAxisProps(COLORS, fmt, 'Revenue'),
      valueYAxisProps(COLORS, fmt, null),
    ]
    let checked = 0
    for (const props of cases) {
      // A custom tick element owns its color internally; a plain object must
      // spell it. Anything else — an object with no `fill` — is the bug.
      for (const slot of [props.tick, props.label]) {
        if (slot == null) continue
        if (typeof slot === 'object' && 'type' in slot) continue // React element
        expect(slot, 'a plain tick/label object must name its fill').toHaveProperty('fill')
        expect((slot as { fill: unknown }).fill).toBe(COLORS.inkSoft)
        checked++
      }
    }
    // 4 cases → tick+label, tick, tick+label, tick = 6 plain objects, minus the
    // one custom-element tick = 5. Pinned so a shrinking selection is loud.
    expect(checked, 'the loop stopped inspecting anything').toBe(5)
  })

  it('hands the long-label axis a custom tick element, which owns its color', () => {
    // `longX` swaps the plain object for <TruncatedTick/>, which reads the theme
    // itself — see AxisColors.inkSoft on why the parameter cannot reach it.
    const props = timeSeriesXAxisProps(COLORS, 'month', null, true)
    expect(props.tick).toHaveProperty('type')
    expect(props.tick).not.toHaveProperty('fill')
  })
})

describe('tick elements render their label in ink, not in the axis color', () => {
  // Read from the theme rather than hardcoded: MonteCarloPanel.test.tsx already
  // does this, and a literal turns a token change into a failure that points at
  // the test instead of at the decision.
  const INK_SOFT_LIGHT = chartTheme('light').INK_SOFT

  it('TruncatedTick', () => {
    render(
      <svg>
        <TruncatedTick x={0} y={0} payload={{ value: 'January' }} />
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

  it('is the ink token and not the axis token', () => {
    // Guards the pair, not just one side: if AXIS and INK_SOFT were ever set to
    // the same value the assertions above would still pass while the fix was
    // undone.
    const { AXIS, INK_SOFT } = chartTheme('light')
    expect(INK_SOFT).not.toBe(AXIS)
  })
})
