/**
 * Proves, against the real recharts, that an explicit `tick.fill` beats the
 * color recharts derives from the axis `stroke`.
 *
 * Everything else about this fix is asserted on our own source: that the props
 * carry INK_SOFT, that no source line fills with AXIS. None of that is worth
 * anything if recharts ignores the override — the labels would still render at
 * 3.24–4.02 and every green test would be describing a fix that did not happen.
 * So this one renders the library and reads the attribute off the DOM.
 *
 * `ResponsiveContainer` measures to 0×0 under jsdom and renders nothing, so the
 * charts here are given explicit width/height instead.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LineChart, XAxis, YAxis } from 'recharts'
import { timeSeriesXAxisProps, valueYAxisProps } from './axis'
import { chartTheme } from './theme'

const RULE = '#AA0000'
const INK = '#00BB00'
const COLORS = { axis: RULE, inkSoft: INK }
const DATA = [
  { month: 'Jan', v: 1 },
  { month: 'Feb', v: 2 },
]

/** Fill colors of the tick labels recharts actually painted. */
function tickFills(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.recharts-cartesian-axis-tick text')].map(
    (el) => el.getAttribute('fill') ?? '',
  )
}

describe('recharts honours the explicit tick fill', () => {
  it('paints tick labels with tick.fill, not with the axis stroke', () => {
    const { container } = render(
      <LineChart width={400} height={300} data={DATA}>
        <XAxis {...timeSeriesXAxisProps(COLORS, 'month', 'Month', false)} />
        <YAxis {...valueYAxisProps(COLORS, String, 'Value')} />
      </LineChart>,
    )
    const fills = tickFills(container)
    expect(fills.length).toBeGreaterThan(0)
    expect(fills).not.toContain(RULE)
    for (const f of fills) expect(f).toBe(INK)
  })

  it('would have painted them with the stroke had the override been dropped', () => {
    // The control. Without this, the assertion above could be green because
    // recharts defaults to something else entirely — and the override would be
    // decoration rather than the thing doing the work.
    const { container } = render(
      <LineChart width={400} height={300} data={DATA}>
        <XAxis dataKey="month" stroke={RULE} tickLine={false} />
      </LineChart>,
    )
    expect(tickFills(container)).toContain(RULE)
  })

  it('keeps the axis rule itself on the stroke color', () => {
    // The other half of the split: darkening the labels must not darken the line.
    const { container } = render(
      <LineChart width={400} height={300} data={DATA}>
        <XAxis {...timeSeriesXAxisProps(COLORS, 'month', null, false)} />
      </LineChart>,
    )
    const line = container.querySelector('.recharts-cartesian-axis-line')
    expect(line).not.toBeNull()
    expect(line).toHaveAttribute('stroke', RULE)
  })

  it('does not let the injected fill reach a custom tick element', () => {
    // The SECOND mechanism, and the one the tests above never touch. When
    // `tick` is an element, recharts goes through
    // `cloneElement(tick, { …axisProps, fill: stroke, … })` instead of merging
    // a props object — and cloneElement lets the injected props win. The whole
    // reason TruncatedTick reads the theme instead of accepting `fill` is that
    // this injection would otherwise repaint it in the axis stroke.
    //
    // This path serves every long-label time axis (`longX`) and every Bar
    // chart's category axis, so leaving it to reasoning would leave most of the
    // product's tick labels unproven.
    const { container } = render(
      <LineChart width={400} height={300} data={DATA}>
        <XAxis {...timeSeriesXAxisProps(COLORS, 'month', null, true)} />
      </LineChart>,
    )
    const fills = tickFills(container)
    expect(fills.length).toBeGreaterThan(0)
    expect(fills).not.toContain(RULE)
    // The element owns its color, so it is the THEME's ink here — not the
    // `inkSoft` argument, which cannot reach this branch. See AxisColors.
    for (const f of fills) expect(f).toBe(chartTheme('light').INK_SOFT)
  })

  it('paints the axis title with the fill the builder supplies', () => {
    // Without an explicit fill recharts renders the title at a hardcoded
    // #808080, which fails AA on five of six surface/mode combinations while
    // never mentioning AXIS — invisible to a source scan looking for the token.
    const { container } = render(
      <LineChart width={400} height={300} data={DATA}>
        <XAxis {...timeSeriesXAxisProps(COLORS, 'month', 'Month', false)} />
      </LineChart>,
    )
    const title = container.querySelector('.recharts-label')
    expect(title).not.toBeNull()
    expect(title).toHaveAttribute('fill', INK)
  })

  it('would have painted the title #808080 had the fill been omitted', () => {
    // The control for the assertion above.
    const { container } = render(
      <LineChart width={400} height={300} data={DATA}>
        <XAxis dataKey="month" stroke={RULE} label={{ value: 'Month', position: 'insideBottom' }} />
      </LineChart>,
    )
    expect(container.querySelector('.recharts-label')).toHaveAttribute('fill', '#808080')
  })
})
