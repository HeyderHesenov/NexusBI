import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { DecisionTrajectory } from '../../types'

/** Recharts sizes itself from the container, and jsdom reports 0×0 — so nothing
 *  is drawn and there is no chart surface to hover, which is why the tooltip's
 *  label renderer had no coverage at all.
 *
 *  So `Tooltip` is replaced by a stand-in that calls the `labelFormatter` the
 *  component passed it, with the payload shape recharts documents (and that
 *  PieChartWidget already relies on in production), and renders the result.
 *  That covers the wiring, the branch, the i18n key and the date formatting.
 *
 *  ⚠️ What it does NOT cover, stated rather than implied: whether recharts
 *  really hands back that payload shape. Only a real render could show that, and
 *  a real render is what jsdom cannot give us here. */
const seenLabelFormatter = vi.fn()

vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const Nothing = () => null
  return {
    // Chart context lives in ComposedChart; the axes throw without it, so every
    // piece except the one under test is stubbed out rather than half-rendered.
    ResponsiveContainer: Pass,
    ComposedChart: Pass,
    Area: Nothing,
    CartesianGrid: Nothing,
    Legend: Nothing,
    Line: Nothing,
    ReferenceLine: Nothing,
    XAxis: Nothing,
    YAxis: Nothing,
    Tooltip: ({
      labelFormatter,
    }: {
      labelFormatter?: (label: unknown, payload: unknown) => ReactNode
    }) => {
      seenLabelFormatter(labelFormatter)
      const row = (globalThis as { __row?: unknown }).__row
      return <div data-testid="tip">{labelFormatter?.('10 yanvar', [{ payload: row }])}</div>
    },
  }
  // No `satisfies typeof import('recharts')` here, unlike the mocks elsewhere in
  // this repo: recharts' exports carry statics (displayName and friends) that a
  // stub cannot supply, so the constraint fails on the stubs rather than on any
  // drift worth catching. Drift is caught upstream instead — TrajectoryChart
  // imports these names itself, so a rename breaks the real component's import.
})

const { TrajectoryChart } = await import('./TrajectoryChart')

const point = (measured_at: string, data_as_of: string | null) => ({
  id: 'p1',
  value: 120,
  measured_at,
  data_as_of,
  query_log_id: null,
})

function renderWith(trajectory: DecisionTrajectory) {
  // Hand the stand-in the same row the chart computed, so the assertion runs on
  // trajectoryRows' real output rather than a hand-written imitation of it.
  const rows = trajectoryRows(trajectory)
  ;(globalThis as { __row?: unknown }).__row = rows[0]
  return render(<TrajectoryChart trajectory={trajectory} baseline={100} />)
}

const { trajectoryRows } = await import('../../lib/trajectory')
const { formatDate } = await import('../../lib/format')

describe('TrajectoryChart data-age caption', () => {
  it('names the fetch time when the data is older than the point', () => {
    renderWith({
      points: [point('2026-01-10T12:00:00Z', '2026-01-10T09:00:00Z')],
      counterfactual: null,
    })
    const tip = screen.getByTestId('tip')
    expect(tip).toHaveTextContent('10 yanvar')
    // The az bundle renders "data: {{at}}" — assert the real string, not the key,
    // so a missing translation fails instead of rendering "decisionsPage.dataAsOf".
    expect(tip.textContent).toMatch(/data:/)
    // The caption must name data_as_of, NOT measured_at — pointing it at the
    // wrong one of the two is the single mistake this whole column exists to
    // prevent, and both stamps are on the row it was handed. Expected values go
    // through the app formatter so the assertion holds in any runner timezone.
    const asOf = formatDate('2026-01-10T09:00:00Z', { locale: 'az-AZ', mode: 'short' })
    const measured = formatDate('2026-01-10T12:00:00Z', { locale: 'az-AZ', mode: 'short' })
    expect(tip.textContent).toContain(asOf)
    expect(tip.textContent).not.toContain(measured)
  })

  it('shows the plain label alone when the age is unknown', () => {
    renderWith({ points: [point('2026-01-10T12:00:00Z', null)], counterfactual: null })
    const tip = screen.getByTestId('tip')
    expect(tip).toHaveTextContent('10 yanvar')
    expect(tip.textContent).not.toMatch(/data:/)
  })

  it('actually passes a labelFormatter to Tooltip', () => {
    renderWith({ points: [point('2026-01-10T12:00:00Z', null)], counterfactual: null })
    const calls = seenLabelFormatter.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(typeof calls[calls.length - 1][0]).toBe('function')
  })
})
