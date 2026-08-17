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
 * Both multi-series widgets are covered, because they carry the palette
 * differently: the line chart paints strokes only, while the area chart paints the
 * same hex twice — an opaque stroke that carries the series identity and a 0.08
 * wash that does not. The floors apply to the stroke; the wash is asserted
 * separately so "we paint at full opacity" cannot quietly become false for it.
 *
 * `ResponsiveContainer` measures to 0×0 under jsdom and renders nothing, so it —
 * and only it — is replaced by a fixed-size pass-through. Everything else is real
 * recharts; stubbing more would turn this into a test of the stubs.
 */
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AreaChartWidget } from './AreaChartWidget'
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
 * empty list, which is why every query here asserts its own length first.
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

/** Render one widget in one mode, and hand back the marks it drew. */
function draw(mode: 'light' | 'dark', Widget: typeof LineChartWidget | typeof AreaChartWidget) {
  useThemeStore.setState({ mode })
  const { container } = render(<Widget data={[...DATA]} config={{ ...CONFIG }} />)
  const pick = (sel: string, expected: number) => {
    const els = [...container.querySelectorAll(sel)]
    // Every query asserts its own count: a selector that silently matches nothing
    // turns each loop below into a vacuous pass, which is how this file's first
    // run reported an opacity claim it had not measured.
    expect(els, `${mode}: expected ${expected} of "${sel}", drew ${els.length}`).toHaveLength(expected)
    return els
  }
  // Lazy, so a widget that legitimately draws none of one kind does not fail the
  // tests that never asked about it.
  return {
    strokes: () => pick('path.recharts-line-curve, path.recharts-area-curve', 6),
    areas: () => pick('path.recharts-area-area', 6),
    // ONE rule, not two: `valueYAxisProps` sets `axisLine: false`, so the Y axis
    // contributes ticks and labels but no line. Pinned at the count rather than
    // "at least one", since a Y rule appearing would be a design change that puts
    // a second AXIS-coloured mark on the canvas.
    rules: () => pick('.recharts-cartesian-axis-line', 1),
  }
}

describe.each(['light', 'dark'] as const)('the %s palette reaches the canvas', (mode) => {
  afterEach(() => {
    cleanup()
    useThemeStore.setState({ mode: 'light' })
  })

  it.each([
    ['line', LineChartWidget],
    ['area', AreaChartWidget],
  ] as const)('paints the six %s series in the exact hexes theme.test scores', (_kind, Widget) => {
    const strokes = draw(mode, Widget).strokes()
    expect(strokes.map((el) => el.getAttribute('stroke')?.toUpperCase())).toEqual(chartTheme(mode).SERIES)
    for (const el of strokes) {
      // Ancestors included, style before attribute: a wrapper <g> fading the
      // layer would move every ΔE00 in `theme.test` without touching a hex.
      expect(effectiveOpacity(el), `${mode}: ${el.getAttribute('stroke')} is not painted at full opacity`).toBe(1)
    }
  })

  it('washes the area fill without letting it stand in for the stroke', () => {
    // The one place a SERIES colour IS composited. Pinned rather than waved past:
    // the wash may not creep up toward the stroke (which would make two marks of
    // one series and blur the boundary the floors are drawn at), and the stroke
    // beside it may not be dragged down with it.
    const { strokes, areas } = draw(mode, AreaChartWidget)
    for (const el of areas()) {
      expect(el.getAttribute('fill')?.toUpperCase(), `${mode}: the wash left the palette`)
        .toBeOneOf(chartTheme(mode).SERIES)
      expect(effectiveOpacity(el, 'fill'), `${mode}: the area wash moved off 0.08`).toBeCloseTo(0.08, 4)
    }
    for (const el of strokes()) expect(effectiveOpacity(el)).toBe(1)
  })

  it('paints the axis rule in AXIS, which is the mark S5 is scored against', () => {
    const rules = draw(mode, LineChartWidget).rules()
    for (const rule of rules) {
      expect(rule.getAttribute('stroke')?.toUpperCase()).toBe(chartTheme(mode).AXIS)
      expect(effectiveOpacity(rule), `${mode}: the axis rule is faded`).toBe(1)
    }
  })
})
