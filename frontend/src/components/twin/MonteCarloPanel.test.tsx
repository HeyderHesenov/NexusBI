import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { leaf, node } from '../../test/metricTreeFixtures'
import { chartTheme } from '../charts/theme'
import { MonteCarloPanel } from './MonteCarloPanel'

const l1 = leaf('a', 100, 'Qiymət')
const l2 = leaf('b', 50, 'Həcm')
// `add`, not `sum`. combine() supports add|sub|mul|div and falls through to
// `return 0` for anything else, so an unrecognised operator makes all 2000 draws
// evaluate to 0: P10 = P50 = P90 = 0, one distinct sample, all three labels
// stacked at the plot's left edge, and the baseline marker skipped entirely
// because 150 falls outside [0, 0]. Measured both ways — `sum` gives
// {p10: 0, p50: 0, p90: 0}, `add` gives {141.8, 149.8, 157.9} over 2000 distinct
// samples. The fixture's `operator: string` type is what let the typo compile.
const root = node('kpi', 'add', [l1, l2], 150)
const ranges = { a: { min: -10, max: 10 }, b: { min: -5, max: 5 } }

const INK_SOFT = chartTheme('light').INK_SOFT

const renderPanel = () =>
  render(
    <MonteCarloPanel
      root={root}
      leaves={[l1, l2]}
      baseline={150}
      ranges={ranges}
      onSetRange={vi.fn()}
      onClear={vi.fn()}
    />,
  )

const renderRun = () => {
  const view = renderPanel()
  // The distribution only exists after a run — the panel starts empty.
  fireEvent.click(screen.getByRole('button', { name: /2000/ }))
  return view
}

describe('MonteCarloPanel', () => {
  it('inks every marker label instead of coloring it', () => {
    // The labels used to take the same `fill` as their rule: P50 the accent
    // (#0E9F6E, 3.21:1 as text in light mode), P10/P90 the dusty blue (2.69:1),
    // the baseline the axis grey (3.39:1) — all three below AA, at fontSize 10.
    // The rule directly under each label still carries the color.
    const { container } = renderRun()
    const labels = [...container.querySelectorAll('svg text')].filter((t) =>
      /^(P10|P50|P90)$/.test(t.textContent ?? ''),
    )
    expect(labels.length).toBe(3)

    // Read from the theme rather than restated as a hex: darkening --ink-soft
    // would otherwise fail this test while the component stayed correct. What is
    // being pinned is "labels follow the ink token", not one particular pigment.
    for (const label of labels) expect(label.getAttribute('fill')).toBe(INK_SOFT)

    // The baseline label is drawn too, and inked the same way. It is asserted
    // separately because with symmetric ranges it lands on top of P50 — the
    // reason it anchors `end` while the percentiles anchor `middle`.
    const baselineLabel = [...container.querySelectorAll('svg text')].find(
      (t) => t.getAttribute('text-anchor') === 'end',
    )
    expect(baselineLabel).toBeDefined()
    expect(baselineLabel!.getAttribute('fill')).toBe(INK_SOFT)

    // ...while the marker rules keep their palette colors — the point of the
    // split. Asserted together so "ink everything" cannot pass as the fix.
    // Read off the theme for the same reason INK_SOFT is: the palette is
    // per-mode now, and a literal here would pin one mode's pigment rather than
    // the rule that the marker keeps its accent.
    const strokes = [...container.querySelectorAll('svg line')].map((l) => l.getAttribute('stroke'))
    expect(strokes).toContain(chartTheme('light').ACCENT)
  })

  it('leaves no inline text color anywhere in the panel', () => {
    // The same assertion TwinSliders.test.tsx makes. Omitting it here is exactly
    // why the Stat delta — `style={{ color: DANGER }}` on a text-xs <p>, 2.63:1
    // on the emphasised P50 card — survived the first pass of this migration in
    // the very file the change was editing.
    const { container } = renderRun()
    expect(container.querySelector('[style*="color"]')).toBeNull()
  })

  it('shows nothing until the simulation is run', () => {
    const { container } = renderPanel()
    expect(container.querySelector('svg text')).toBeNull()
  })
})
