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
 * All THREE palette-carrying widgets are covered, because they carry it
 * differently: the line chart paints strokes only, the area chart paints the same
 * hex twice — an opaque stroke that carries the series identity and a 0.08 wash
 * that does not — and the pie is the only widget that paints INK_FAINT as a mark
 * rather than as a rule. Leaving the pie out was not neutral: INK_FAINT is in the
 * scored population BECAUSE of the folded "other" wedge, so the widget the floors
 * were written for was the one widget nothing rendered. This repo has also already
 * shipped a live pie export defect on this exact path (`rgb(var(...))` lost in
 * serialized SVG), so "the pie paints hexes" is not a safe assumption to leave
 * unasserted.
 *
 * ⚠️ AND THE EXEMPTIONS ARE ASSERTED HERE, NOT IN `theme.test`. Two inks reach a
 * canvas without being scored, and both stay out on the strength of a SECOND
 * CHANNEL — a dash, and a word. `theme.test` used to check that by calling
 * `targetLineProps` with its own literals and asserting they came back, which is
 * true of any function that forwards its arguments and says nothing about the
 * widgets. The channels are read off the rendered DOM here instead.
 *
 * `ResponsiveContainer` measures to 0×0 under jsdom and renders nothing, so it —
 * and only it — is replaced by a fixed-size pass-through. Everything else is real
 * recharts; stubbing more would turn this into a test of the stubs.
 */
import { cloneElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AreaChartWidget } from './AreaChartWidget'
import { LineChartWidget } from './LineChartWidget'
import { PieChartWidget, TOP_N } from './PieChartWidget'
import { TrajectoryChart } from '../decision/TrajectoryChart'
import type { ChartConfig, DecisionTrajectory } from '../../types'
import { chartTheme, inkFraction, SERIES_COUNT } from './theme'
import { useThemeStore } from '../../store/themeStore'
import { effectiveOpacity } from '../../test/svgOpacity'

/**
 * The size has to be PASSED DOWN, not merely wrapped: recharts' real container
 * clones its child with measured `width`/`height`, and a chart left at 0×0 draws
 * an empty <svg>. A pass-through that only rendered a sized <div> produced zero
 * lines and zero axis rules — and the opacity assertion below went green on the
 * empty list, which is why every query here asserts its own length first.
 *
 * ⚠️ AND THE MARKS HAVE TO BE READ IN THEIR SETTLED STATE, which is a second thing
 * jsdom does not give for free. recharts draws lines and wedges through
 * react-smooth, which drives itself on `requestAnimationFrame` — and jsdom never
 * ticks one, so the animation is frozen at frame zero forever. Measured, that is
 * not "slightly early": a `<Line strokeDasharray="5 5">` reports `0px, 0px` (the
 * draw-in wipe, not its own pattern) and a `<Pie>` renders its sector GROUPS with
 * no `<path>` inside them at all. Advancing vitest's fake timers does not help,
 * since the frame callback is the thing that never runs.
 *
 * So `isAnimationActive={false}` is forced onto the three animated marks. This
 * stubs TIMING, not paint: every hex, dash and opacity asserted below is the
 * component's own prop, read at the state a reader sees a moment after the chart
 * appears. Nothing about the entry animation itself is claimed here.
 */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  // React is imported HERE rather than at the top of the file: `vi.mock` factories
  // are hoisted above the import bindings, and `class … extends Component` runs at
  // factory time, so the module-scope binding is still uninitialized — the whole
  // file failed to collect with "Cannot access before initialization".
  const { Component, createElement } = await import('react')
  const settled = <T,>(C: T): T => {
    // A CLASS, not a function component, and for one measured reason: recharts
    // filters its children by their type's statics AND reads `defaultProps` off
    // the type while laying the chart out — copying `displayName` alone left every
    // widget below drawing nothing — but React warns about `defaultProps` on a
    // FUNCTION component, so a function wrapper carrying them prints a
    // deprecation the app itself (which renders recharts' own classes) never
    // trips. A class carries the same statics without the warning.
    class Settled extends Component<Record<string, unknown>> {
      render() {
        const Inner = C as ComponentType<Record<string, unknown>>
        return createElement(Inner, { ...this.props, isAnimationActive: false })
      }
    }
    // Cast back to the component's own type so the module keeps its real shape —
    // recharts' prop types are what the widgets are checked against.
    return Object.assign(Settled, C) as unknown as T
  }
  return {
    ...actual,
    Line: settled(actual.Line),
    Area: settled(actual.Area),
    Pie: settled(actual.Pie),
    ResponsiveContainer: ({ children }: { children?: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, {
            width: 640,
            height: 400,
          })
        : null,
  }
})

/**
 * One category per series — DERIVED, because the fixture's job is to exercise
 * every colour. Hard-coding six letters meant that raising `SERIES_COUNT` would
 * leave this suite quietly grading a palette it no longer covered, which is the
 * failure a fixture cannot report on itself.
 */
const CATS = [...Array(SERIES_COUNT).keys()].map((i) => String.fromCharCode(97 + i))
const DATA = ['Jan', 'Feb', 'Mar'].flatMap((month, i) =>
  CATS.map((cat, j) => ({ month, cat, v: 10 + i * 5 + j })),
)
const CONFIG: ChartConfig = { chart_type: 'line', x_axis: 'month', y_axis: 'v', color_by: 'cat' }

/** Where the KPI target line lands — any value in range renders the ReferenceLine. */
const TARGET = 20

/** Render one cartesian widget in one mode, and hand back the marks it drew. */
function draw(mode: 'light' | 'dark', Widget: typeof LineChartWidget | typeof AreaChartWidget) {
  useThemeStore.setState({ mode })
  const { container } = render(
    <Widget data={[...DATA]} config={{ ...CONFIG }} targetValue={TARGET} />,
  )
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
    container,
    strokes: () => pick('path.recharts-line-curve, path.recharts-area-curve', SERIES_COUNT),
    areas: () => pick('path.recharts-area-area', SERIES_COUNT),
    // ONE rule, not two: `valueYAxisProps` sets `axisLine: false`, so the Y axis
    // contributes ticks and labels but no line. Pinned at the count rather than
    // "at least one", since a Y rule appearing would be a design change that puts
    // a second AXIS-coloured mark on the canvas.
    rules: () => pick('.recharts-cartesian-axis-line', 1),
    target: () => pick('.recharts-reference-line line', 1),
  }
}

/** A stroke's dash, in the form `inkFraction` reads (absent = solid = 1). */
const dashOf = (el: Element) => inkFraction(el.getAttribute('stroke-dasharray') ?? undefined)

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
    //
    // ⚠️ ORDERED, NOT MEMBERSHIP. This asked `toBeOneOf(SERIES)` first, which only
    // says each wash is somewhere in the palette: measured, `fill={SERIES[0]}` for
    // every band left it green — six stacked bands washed in one emerald, their
    // identity gone everywhere they overlap, while the strokes above stayed
    // correct. The wash carries a series too, so it is compared the same way.
    const { strokes, areas } = draw(mode, AreaChartWidget)
    const bands = areas()
    expect(bands.map((el) => el.getAttribute('fill')?.toUpperCase()), `${mode}: the wash left the palette`)
      .toEqual(chartTheme(mode).SERIES)
    for (const el of bands) {
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

  it('folds the pie onto the wedge set theme.test scores, INK_FAINT included', () => {
    // The widget the floors were written for: no on-arc labels, so colour is the
    // whole channel. `TOP_N + 1` categories is the smallest input that folds, and
    // the fold is what puts INK_FAINT on the canvas beside the series.
    useThemeStore.setState({ mode })
    const rows = [...Array(TOP_N + 2).keys()].map((i) => ({ cat: `c${i}`, v: 100 - i }))
    const { container } = render(
      <PieChartWidget
        data={rows}
        config={{ chart_type: 'pie', x_axis: 'cat', y_axis: 'v', color_by: null }}
      />,
    )
    const wedges = [...container.querySelectorAll('path.recharts-sector')]
    expect(wedges, `${mode}: the pie drew ${wedges.length} wedges`).toHaveLength(TOP_N + 1)
    const { SERIES, INK_FAINT } = chartTheme(mode)
    expect(wedges.map((el) => el.getAttribute('fill')?.toUpperCase())).toEqual([
      ...SERIES.slice(0, TOP_N),
      INK_FAINT,
    ])
    for (const el of wedges) {
      expect(effectiveOpacity(el, 'fill'), `${mode}: a wedge is not painted at full opacity`).toBe(1)
    }
  })

  it('keeps the dash and the word the KPI target line is exempt on', () => {
    // INK_SOFT is left out of the scored population because the marks it draws say
    // which mark they are by dash AND by word. Read off the rendered chart, not off
    // `targetLineProps` with the test's own literals handed back to it: that form
    // holds for any function that forwards its arguments, and measured, all three
    // widgets could pass an EMPTY label with the suite green.
    const { target, container } = draw(mode, LineChartWidget)
    const line = target()[0]
    expect(line.getAttribute('stroke')?.toUpperCase()).toBe(chartTheme(mode).INK_SOFT.toUpperCase())
    // `toBeTruthy` was the old form and `'0'` satisfies it while painting an
    // unbroken line. The ink fraction is the quantity a dash actually is: solid
    // reads 1, and an all-zero pattern throws rather than passing quietly.
    expect(dashOf(line), `${mode}: the target line is not dashed`).toBeLessThan(1)
    const label = container.querySelector('.recharts-reference-line .recharts-label')
    expect(label?.textContent?.trim(), `${mode}: the target line lost its word`).toBeTruthy()
  })
})

/**
 * The trajectory chart is not a palette widget, but it is where the OTHER
 * exemption is spent: it draws a DATA LINE in INK_SOFT beside a data line in
 * ACCENT — which is SERIES[0] — and those two measure ΔE00 6.56 / ΔL* 0.37 apart
 * in dark mode, under both shipped floors. `theme.test`'s register prices that
 * pair; the dash is the entire reason it is allowed to ship, and measured, it
 * could be deleted from the component with all 808 tests green.
 */
describe.each(['light', 'dark'] as const)('the %s exempt ink keeps its second channel', (mode) => {
  afterEach(() => {
    cleanup()
    useThemeStore.setState({ mode: 'light' })
  })

  const TRAJECTORY: DecisionTrajectory = {
    points: [
      { id: 'p1', value: 100, measured_at: '2026-01-01T00:00:00Z', data_as_of: null, query_log_id: null },
      { id: 'p2', value: 120, measured_at: '2026-01-02T00:00:00Z', data_as_of: null, query_log_id: null },
    ],
    counterfactual: {
      method: 'forecast',
      band: [
        { measured_at: '2026-01-01T00:00:00Z', yhat: 95, lower: 90, upper: 100 },
        { measured_at: '2026-01-02T00:00:00Z', yhat: 105, lower: 100, upper: 110 },
      ],
      counterfactual_value: 105,
      delta_vs_counterfactual: 15,
    },
  }

  it('draws the counterfactual dashed and the realized line solid', () => {
    useThemeStore.setState({ mode })
    const { container } = render(<TrajectoryChart trajectory={TRAJECTORY} baseline={90} />)
    const curves = [...container.querySelectorAll('path.recharts-line-curve')]
    expect(curves, `${mode}: expected both trajectory lines, drew ${curves.length}`).toHaveLength(2)

    const { ACCENT, INK_SOFT } = chartTheme(mode)
    const byStroke = new Map(curves.map((el) => [el.getAttribute('stroke')?.toUpperCase(), el]))
    // By colour rather than by DOM order: which one recharts emits first is not
    // the fact under test, and an order flip would otherwise read as a pass.
    expect([...byStroke.keys()].sort(), `${mode}: the trajectory changed colours`)
      .toEqual([ACCENT.toUpperCase(), INK_SOFT.toUpperCase()].sort())

    const counterfactual = byStroke.get(INK_SOFT.toUpperCase())!
    const realized = byStroke.get(ACCENT.toUpperCase())!
    expect(dashOf(counterfactual), `${mode}: the counterfactual line lost its dash`).toBeLessThan(1)
    // …and the line it is told apart FROM has to stay solid, or "one is dashed"
    // stops being a difference between them.
    expect(dashOf(realized), `${mode}: the realized line became dashed too`).toBe(1)
    expect(effectiveOpacity(counterfactual)).toBe(1)
    expect(effectiveOpacity(realized)).toBe(1)
  })
})
