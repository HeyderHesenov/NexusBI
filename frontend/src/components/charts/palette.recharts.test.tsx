/**
 * The join between `charts/theme.test` and the canvas.
 *
 * That suite scores HEXES: it proves the six series and the faint-ink mark stay
 * ΔE00 10 and ΔL* 4.5 apart in a table. Every one of those numbers describes the
 * screen only while two things hold — the chart paints those exact hexes, and it
 * paints them at full opacity. Neither is asserted there, and neither is idle
 * speculation in this repo: a composited mark reading 0.9 while painting 0.18 is
 * the defect `ForceGraph.test` exists to prevent, and a recharts `Area` silently
 * MULTIPLYING its own 0.6 default into an explicit fill opacity is a regression
 * this codebase has already shipped once (see `ForecastChartWidget`).
 *
 * So this renders the real library and reads the marks back off the DOM. What it
 * covers is narrow on purpose: the multi-series line chart, which is the widget
 * that can put all six colours plus the axis rule on one canvas at once, and
 * therefore the one the palette floors are written for.
 *
 * `ResponsiveContainer` measures to 0×0 under jsdom and renders nothing, so it —
 * and only it — is replaced by a fixed-size pass-through. Everything else is real
 * recharts; stubbing more would turn this into a test of the stubs.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LineChartWidget } from './LineChartWidget'
import type { ChartConfig } from '../../types'
import { chartTheme } from './theme'
import { useThemeStore } from '../../store/themeStore'
import { effectiveOpacity } from '../../test/svgOpacity'

/**
 * The size has to be PASSED DOWN, not merely wrapped: recharts' real container
 * clones its child with measured `width`/`height`, and a chart left at 0×0 draws
 * an empty <svg>. A pass-through that only rendered a sized <div> produced zero
 * lines and zero axis rules — and the opacity assertion below went green on the
 * empty list, which is why it now refuses an empty one.
 */
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
    isValidElement(children)
      ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, {
          width: 640,
          height: 400,
        })
      : null,
}))

/** Six categories over three x-values — the widest a single chart can colour. */
const DATA = ['Jan', 'Feb', 'Mar'].flatMap((month, i) =>
  ['a', 'b', 'c', 'd', 'e', 'f'].map((cat, j) => ({ month, cat, v: 10 + i * 5 + j })),
)
const CONFIG: ChartConfig = { chart_type: 'line', x_axis: 'month', y_axis: 'v', color_by: 'cat' }

const lineStrokes = (c: HTMLElement) =>
  [...c.querySelectorAll('path.recharts-line-curve')].map((el) => ({
    el,
    stroke: el.getAttribute('stroke') ?? '',
  }))

describe.each(['light', 'dark'] as const)('the %s palette reaches the canvas', (mode) => {
  afterEach(() => {
    cleanup()
    useThemeStore.setState({ mode: 'light' })
  })

  it('paints the six series in the exact hexes theme.test scores', () => {
    useThemeStore.setState({ mode })
    const { container } = render(<LineChartWidget data={[...DATA]} config={{ ...CONFIG }} />)
    const drawn = lineStrokes(container)
    // Six, not "at least one": a pivot that quietly folded two categories would
    // leave the sixth colour untested here while the table still scored it.
    expect(drawn, `${mode}: the chart drew ${drawn.length} series, not 6`).toHaveLength(6)
    expect(drawn.map((d) => d.stroke.toUpperCase())).toEqual(chartTheme(mode).SERIES)
  })

  it('paints them at full opacity, so the scored distances are the painted ones', () => {
    useThemeStore.setState({ mode })
    const { container } = render(<LineChartWidget data={[...DATA]} config={{ ...CONFIG }} />)
    const drawn = lineStrokes(container)
    // Without this the loop below is green on an empty list — which is exactly
    // what happened the first time this file ran.
    expect(drawn, `${mode}: nothing was drawn to measure`).toHaveLength(6)
    for (const { el, stroke } of drawn) {
      // Ancestors included, style before attribute: a wrapper <g> fading the
      // layer would move every ΔE00 in `theme.test` without touching a hex.
      expect(effectiveOpacity(el), `${mode}: series ${stroke} is not painted at full opacity`).toBe(1)
    }
  })

  it('paints the axis rule in AXIS, which is the mark S5 is scored against', () => {
    useThemeStore.setState({ mode })
    const { container } = render(<LineChartWidget data={[...DATA]} config={{ ...CONFIG }} />)
    const rules = [...container.querySelectorAll('.recharts-cartesian-axis-line')]
    expect(rules, `${mode}: no axis rule was drawn`).not.toHaveLength(0)
    for (const rule of rules) {
      expect(rule.getAttribute('stroke')?.toUpperCase()).toBe(chartTheme(mode).AXIS)
      expect(effectiveOpacity(rule), `${mode}: the axis rule is faded`).toBe(1)
    }
  })
})
