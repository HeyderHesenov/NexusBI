import { createRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForceGraph, type GraphHandle } from './ForceGraph'
import { LAYOUT_W } from './useForceLayout'
import {
  chartTheme,
  inkFraction,
  RING_DASH,
  RING_OPACITY,
  RING_WIDTH,
  RING_WIDTH_DIM,
  RINGED_STATUSES,
} from '../charts/theme'
import { composite, contrastRatio } from '../../lib/color'
import { useThemeStore } from '../../store/themeStore'
// Painted-opacity reader, shared with `charts/palette.recharts.test` — the two
// hand-written versions this replaced are why it is shared. See its docblock.
import { effectiveOpacity } from '../../test/svgOpacity'
import az from '../../i18n/locales/az.json'
import type { GraphData, GraphHealthStatus } from '../../types'

const DATA: GraphData = {
  nodes: [
    { id: 'ds:demo', type: 'ds', label: 'Demo', ref_id: null },
    { id: 'table:sales', type: 'table', label: 'sales', ref_id: null },
    { id: 'widget:w1', type: 'widget', label: 'W1', ref_id: 'w1' },
  ],
  edges: [
    { source: 'ds:demo', target: 'table:sales', kind: 'hosts' },
    { source: 'table:sales', target: 'widget:w1', kind: 'feeds' },
  ],
}

const base = {
  data: DATA,
  selectedId: null,
  highlight: null,
  hiddenTypes: new Set<never>(),
  showMiniMap: false,
  onSelect: () => {},
}

describe('ForceGraph edge-kind filter', () => {
  it('drops edges whose kind is hidden, keeps the rest', () => {
    const { container, rerender } = render(<ForceGraph {...base} />)
    expect(container.querySelectorAll('[data-edge-kind="feeds"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-edge-kind="hosts"]')).toHaveLength(1)

    rerender(<ForceGraph {...base} hiddenKinds={new Set(['feeds'])} />)
    expect(container.querySelectorAll('[data-edge-kind="feeds"]')).toHaveLength(0)
    expect(container.querySelectorAll('[data-edge-kind="hosts"]')).toHaveLength(1)
  })
})

describe('ForceGraph context menus', () => {
  it('fires node, edge and canvas right-click callbacks', () => {
    const onNode = vi.fn()
    const onEdge = vi.fn()
    const onCanvas = vi.fn()
    const { container } = render(
      <ForceGraph
        {...base}
        onNodeContextMenu={onNode}
        onEdgeContextMenu={onEdge}
        onCanvasContextMenu={onCanvas}
      />,
    )

    fireEvent.contextMenu(container.querySelector('[data-node-id="ds:demo"]')!)
    expect(onNode).toHaveBeenCalledWith('ds:demo', expect.anything())

    // The transparent fat hit-path only renders when an edge handler is wired.
    fireEvent.contextMenu(container.querySelector('[data-edge-hit]')!)
    expect(onEdge).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.any(String), target: expect.any(String) }),
      expect.anything(),
    )

    fireEvent.contextMenu(container.querySelector('[data-testid="force-graph"]')!)
    expect(onCanvas).toHaveBeenCalled()
  })
})

/**
 * Trust-ring guards, and they RENDER rather than read the source.
 *
 * The defect these replace lived through a source-grep guard in `charts/theme.test`
 * that matched `opacity={dimmed ? 0.4 : RING_OPACITY}` and reported green for as
 * long as it existed — it checked the undimmed branch against the composites that
 * file scores, and had no way to notice that the other branch painted the same
 * ring at 1.63–2.40 over the canvas. Reading the attribute off the rendered
 * circle is what closes that: whatever expression produces it, this measures the
 * value that actually reaches the screen.
 */
const MODES = ['light', 'dark'] as const
/**
 * DERIVED, not spelled out. This list and `charts/theme.test`'s used to be two
 * hand-written copies of the same three strings, each citing the other as the
 * thing keeping it honest — so adding a severity and updating one file would
 * have left the other silently narrower while staying green, and this file's
 * `toHaveLength(RINGED.length)` would then have asserted the wrong ring count.
 * `RING_DASH` has to name every ringed severity anyway; it is the single source.
 */
const RINGED = RINGED_STATUSES
/** WCAG 1.4.11, the floor a ring is a graphic under. */
const GRAPHIC = 3

const HEALTH_DATA: GraphData = {
  nodes: [
    { id: 'ds:demo', type: 'ds', label: 'Demo', ref_id: null, status: 'ok', reason: 'fresh' },
    { id: 'metric:warn', type: 'metric', label: 'W', ref_id: null, status: 'warn', reason: 'unverified' },
    { id: 'metric:danger', type: 'metric', label: 'D', ref_id: null, status: 'danger', reason: 'stale' },
    { id: 'metric:unknown', type: 'metric', label: 'U', ref_id: null, status: 'unknown', reason: 'unknown' },
  ],
  edges: [{ source: 'ds:demo', target: 'metric:warn', kind: 'hosts' }],
}

const ringOf = (container: HTMLElement, status: GraphHealthStatus) => {
  const el = container.querySelector(`[data-ring="${status}"]`)
  if (!el) throw new Error(`no ring rendered for status "${status}"`)
  return el
}

describe('ForceGraph trust ring', () => {
  // Unmount before restoring the mode: the theme store is global, so a reset
  // while a graph is still mounted re-renders it outside act() and the resulting
  // warning is noise that would train the next reader to ignore act warnings.
  afterEach(() => {
    cleanup()
    useThemeStore.setState({ mode: 'light' })
  })

  it('never rings an ok node', () => {
    // The premise `charts/theme.test` scores severities on: its RINGED list omits
    // `ok`, which is only sound while this holds. Pinned here instead of trusted,
    // because `ok` is the one severity whose colour is the accent token and would
    // sail through every ratio while meaning something quite different on canvas.
    const { container } = render(<ForceGraph {...base} data={HEALTH_DATA} />)
    expect(container.querySelector('[data-node-id="ds:demo"] [data-ring]')).toBeNull()
    expect(container.querySelectorAll('[data-ring]')).toHaveLength(RINGED.length)
  })

  it.each(MODES)('keeps the DIMMED ring above the non-text floor in %s mode', (mode) => {
    act(() => useThemeStore.setState({ mode }))
    // `highlight` without a hover puts every node outside the set into the dimmed
    // branch — the state that used to drop this mark to opacity 0.4.
    const { container } = render(
      <ForceGraph {...base} data={HEALTH_DATA} highlight={new Set(['ds:demo'])} />,
    )
    const { SURFACE } = chartTheme(mode)

    for (const status of RINGED) {
      const ring = ringOf(container, status)
      // Asserting the width FIRST is what stops this from passing vacuously: if a
      // future edit drops the dim path, the ring renders undimmed and this test
      // would otherwise happily measure the easy state and report green.
      expect(ring.getAttribute('stroke-width'), `${status} is not in the dimmed branch`).toBe(
        String(RING_WIDTH_DIM),
      )
      const alpha = effectiveOpacity(ring)
      const painted = composite(ring.getAttribute('stroke')!, SURFACE, alpha)
      expect(
        contrastRatio(painted, SURFACE),
        `dimmed ${status} ring (${mode}) painted ${painted} on ${SURFACE} at effective alpha ${alpha}`,
      ).toBeGreaterThanOrEqual(GRAPHIC)
    }
  })

  it('de-emphasises a dimmed ring by WIDTH and leaves its opacity alone', () => {
    // The fix stated as an assertion. No opacity below RING_OPACITY clears the
    // floor for these colours — 0.5 reaches 1.87, 0.8 still only 2.97 — so any
    // reintroduced dim-by-fade is a defect however gentle the number looks. Width
    // carries the de-emphasis instead, which 1.4.11 does not score.
    const { container: lit } = render(<ForceGraph {...base} data={HEALTH_DATA} />)
    const { container: dim } = render(
      <ForceGraph {...base} data={HEALTH_DATA} highlight={new Set(['ds:demo'])} />,
    )

    expect(RING_WIDTH_DIM).toBeLessThan(RING_WIDTH)
    for (const status of RINGED) {
      expect(ringOf(lit, status).getAttribute('stroke-width')).toBe(String(RING_WIDTH))
      expect(ringOf(dim, status).getAttribute('stroke-width')).toBe(String(RING_WIDTH_DIM))
      // Effective, not declared: an ancestor <g> carrying the dim is exactly how
      // this went wrong once, and it leaves the attribute reading a healthy 0.9.
      expect(effectiveOpacity(ringOf(lit, status))).toBeCloseTo(RING_OPACITY, 5)
      expect(
        effectiveOpacity(ringOf(dim, status)),
        `${status} fades when dimmed — the defect this ticket closed`,
      ).toBeCloseTo(RING_OPACITY, 5)
    }
  })

  it('gives each severity a distinct dash pattern', () => {
    // The colour-free half of the channel, read off the DOM rather than off
    // RING_DASH — the record being injective says nothing about whether the
    // circle is wired to it.
    const { container } = render(<ForceGraph {...base} data={HEALTH_DATA} />)
    const dashes = RINGED.map((s) => ringOf(container, s).getAttribute('stroke-dasharray'))
    expect(new Set(dashes).size, `severities share a dash: ${JSON.stringify(dashes)}`).toBe(
      RINGED.length,
    )
  })

  it('reads an opacity however it is spelled, at every level', () => {
    // The guard's own guard, pinned by identities rather than through the
    // inequalities every other test here uses. Two versions of `effectiveOpacity`
    // shipped a defect: the first read one element, the second read one SPELLING,
    // and both times the suite went green while the ring painted at 0.18. A
    // helper that only ever appears inside `toBeGreaterThanOrEqual` cannot fail
    // in the direction that matters — reading TOO HIGH always looks like a pass.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const inner = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    svg.append(outer)
    outer.append(inner)
    inner.append(mark)

    expect(effectiveOpacity(mark)).toBe(1)
    // The attribute spelling, on an ancestor.
    outer.setAttribute('opacity', '0.5')
    expect(effectiveOpacity(mark)).toBeCloseTo(0.5, 10)
    // The style spelling — the one that came back as a live defect. It must count
    // for the same as the attribute, and it must MULTIPLY with the level above.
    inner.style.opacity = '0.4'
    expect(effectiveOpacity(mark)).toBeCloseTo(0.2, 10)
    // Style wins over the attribute on the SAME element, as the cascade says.
    inner.setAttribute('opacity', '1')
    expect(effectiveOpacity(mark)).toBeCloseTo(0.2, 10)
    // stroke-opacity fades a stroke on its own and used to be invisible here.
    mark.setAttribute('stroke-opacity', '0.5')
    expect(effectiveOpacity(mark)).toBeCloseTo(0.1, 10)
    // Percentages are legal SVG; `Number('50%')` is NaN, and a NaN would sail
    // through every comparison rather than failing.
    mark.setAttribute('stroke-opacity', '50%')
    expect(effectiveOpacity(mark)).toBeCloseTo(0.1, 10)
    mark.setAttribute('stroke-opacity', 'inherit')
    expect(() => effectiveOpacity(mark)).toThrow(/unreadable/)
  })

  it('ranks the dash code the same way it ranks severity', () => {
    // NOT "the three patterns differ" — that is what the previous pair of guards
    // asserted, and swapping `warn` with `danger` satisfied it while inverting the
    // meaning: measured, that swap left all 759 tests green with the canvas
    // showing the calmer node as the more urgent one. What the design actually
    // claims is an ORDER — solid reads as most urgent, dotted as least — so the
    // assertion is on the quantity that order is stated in.
    const { container } = render(<ForceGraph {...base} data={HEALTH_DATA} />)
    const inkOf = (s: (typeof RINGED)[number]) =>
      inkFraction(ringOf(container, s).getAttribute('stroke-dasharray') ?? undefined)

    expect(inkOf('danger'), 'danger must be the least interrupted ring').toBeGreaterThan(
      inkOf('warn'),
    )
    expect(inkOf('warn'), 'warn must be less interrupted than unknown').toBeGreaterThan(
      inkOf('unknown'),
    )
    // Read off the DOM above, so this also pins that the circle is WIRED to
    // RING_DASH rather than merely that the record is ordered.
    expect(inkOf('danger')).toBe(inkFraction(RING_DASH.danger))
  })

  it('caps only the ring whose dash needs a cap', () => {
    // `'0 5'` is dots ONLY with a round cap, so `unknown` needs one. Every other
    // ring is harmed by it: a cap extends each dash by half the stroke width at
    // both ends, which turned warn's '6 5' into 8.5 on / 2.5 off — a nicked solid
    // ring standing next to a genuinely solid danger, i.e. the two severities the
    // dash exists to separate.
    const { container } = render(<ForceGraph {...base} data={HEALTH_DATA} />)
    expect(ringOf(container, 'unknown').getAttribute('stroke-linecap')).toBe('round')
    for (const s of ['warn', 'danger'] as const) {
      expect(ringOf(container, s).getAttribute('stroke-linecap')).toBeNull()
    }
  })

  it('holds the ring at a constant on-screen size across zoom', () => {
    // The claim RING_WIDTH_DIM rests on is "width does not move the contrast
    // ratio". That is only true while the stroke is wider than a pixel: these are
    // user units, so an unscaled 1.5 fell to ~0.66 CSS px at MIN_ZOOM, and a
    // sub-pixel stroke IS an opacity — the rasteriser composites it at its pixel
    // coverage, landing back under 3:1 by the route this mark left.
    //
    // On-screen size is `userUnits × containerWidth / viewBox.width`, and the
    // container is fixed, so holding `userUnits / viewBox.width` constant is the
    // assertion — no layout needed, which jsdom could not give anyway.
    const ref = createRef<GraphHandle>()
    const { container } = render(<ForceGraph {...base} ref={ref} data={HEALTH_DATA} />)
    const viewW = () => Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2])
    const perUnit = () => {
      const ring = ringOf(container, 'warn')
      const dash = ring.getAttribute('stroke-dasharray')!.split(/\s+/).map(Number)
      return [Number(ring.getAttribute('stroke-width')), ...dash].map((n) => n / viewW())
    }

    const atFit = perUnit()
    expect(viewW()).toBe(LAYOUT_W)
    act(() => ref.current!.zoomBy(2)) // out to MIN_ZOOM
    expect(viewW(), 'zoomBy did not change the viewBox — the test proves nothing').toBe(
      LAYOUT_W / 0.5,
    )

    const atMinZoom = perUnit()
    expect(atMinZoom).toHaveLength(atFit.length)
    atMinZoom.forEach((v, i) => expect(v).toBeCloseTo(atFit[i], 10))
    // And it is the SCALED value that reaches the attribute, not the raw constant
    // — otherwise the ratio above would be constant for the trivial reason.
    expect(Number(ringOf(container, 'warn').getAttribute('stroke-width'))).toBeCloseTo(
      RING_WIDTH * 2,
      10,
    )
  })

  it('sizes the tooltip from the label it actually draws', () => {
    // The rect was sized from the untruncated name while the text renders
    // truncated, so a long asset produced a box about twice as wide as its own
    // contents, centred on the node and covering its neighbours.
    const long = 'A'.repeat(80)
    const { container } = render(
      <ForceGraph
        {...base}
        data={{ ...HEALTH_DATA, nodes: [{ ...HEALTH_DATA.nodes[1], label: long }] }}
      />,
    )
    fireEvent.pointerEnter(container.querySelector('[data-node-id="metric:warn"]')!)

    const tip = container.querySelector('[data-tooltip]')!
    const drawn = tip.querySelector('text:nth-of-type(2)')!.textContent!
    const width = Number(tip.querySelector('rect')!.getAttribute('width'))
    expect(drawn.length).toBeLessThanOrEqual(30)
    // Sized for what is drawn, not for the 80 characters that are not.
    expect(width).toBeLessThan(Number(80 * 6.6 + 24))
    expect(width).toBeCloseTo(30 * 6.6 + 24, 6)
  })

  it('names the severity in the tooltip, and only for ringed nodes', () => {
    // The dash separates warn from danger while scanning; this is what says which
    // is worse. Compared against the catalogue rather than a literal, so a missing
    // key cannot pass as an uppercased key path.
    const { container } = render(<ForceGraph {...base} data={HEALTH_DATA} />)

    fireEvent.pointerEnter(container.querySelector('[data-node-id="metric:danger"]')!)
    // ⚠️ `toLocaleUpperCase('az')`, and the difference is the point. This line used
    // to read `.toUpperCase()` — the SAME wrong operation the component was doing,
    // so the two agreed on 'KRITIK' and the guard could not see that the default
    // locale wants a dotted İ. Comparing a transform against itself proves only
    // that it is deterministic.
    const expected = az.graphPage.healthLevel.danger.toLocaleUpperCase('az')
    expect(expected, 'the az dotted-i case is what this test exists for').toContain('İ')
    expect(container.querySelector('[data-ring-severity]')?.textContent).toBe(expected)

    fireEvent.pointerEnter(container.querySelector('[data-node-id="ds:demo"]')!)
    expect(container.querySelector('[data-ring-severity]')).toBeNull()
  })
})
