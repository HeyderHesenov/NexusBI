import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ForceGraph } from './ForceGraph'
import { chartTheme, RING_OPACITY, RING_WIDTH, RING_WIDTH_DIM } from '../charts/theme'
import { composite, contrastRatio } from '../../lib/color'
import { useThemeStore } from '../../store/themeStore'
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
const RINGED: GraphHealthStatus[] = ['warn', 'danger', 'unknown']
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
      const painted = composite(ring.getAttribute('stroke')!, SURFACE, Number(ring.getAttribute('opacity')))
      expect(
        contrastRatio(painted, SURFACE),
        `dimmed ${status} ring (${mode}) painted ${painted} on ${SURFACE}`,
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
      expect(ringOf(lit, status).getAttribute('opacity')).toBe(String(RING_OPACITY))
      expect(
        ringOf(dim, status).getAttribute('opacity'),
        `${status} fades when dimmed — the defect this ticket closed`,
      ).toBe(String(RING_OPACITY))
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

  it('names the severity in the tooltip, and only for ringed nodes', () => {
    // The dash separates warn from danger while scanning; this is what says which
    // is worse. Compared against the catalogue rather than a literal, so a missing
    // key cannot pass as an uppercased key path.
    const { container } = render(<ForceGraph {...base} data={HEALTH_DATA} />)

    fireEvent.pointerEnter(container.querySelector('[data-node-id="metric:danger"]')!)
    expect(container.querySelector('[data-ring-severity]')?.textContent).toBe(
      az.graphPage.healthLevel.danger.toUpperCase(),
    )

    fireEvent.pointerEnter(container.querySelector('[data-node-id="ds:demo"]')!)
    expect(container.querySelector('[data-ring-severity]')).toBeNull()
  })
})
