import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { leaf, node } from '../../test/metricTreeFixtures'
import { MonteCarloPanel } from './MonteCarloPanel'

const l1 = leaf('a', 100, 'Qiymət')
const l2 = leaf('b', 50, 'Həcm')
const root = node('kpi', 'sum', [l1, l2], 150)
const ranges = { a: { min: -10, max: 10 }, b: { min: -5, max: 5 } }

const renderRun = () => {
  const view = render(
    <MonteCarloPanel
      root={root}
      leaves={[l1, l2]}
      baseline={150}
      ranges={ranges}
      onSetRange={vi.fn()}
      onClear={vi.fn()}
    />,
  )
  // The distribution only exists after a run — the panel starts empty.
  fireEvent.click(screen.getByRole('button', { name: /2000/ }))
  return view
}

describe('MonteCarloPanel', () => {
  it('inks the P10/P50/P90 marker labels instead of coloring them', () => {
    // The labels used to take the same `fill` as their rule: P50 the accent
    // (#0E9F6E, 3.21:1 as text in light mode), P10/P90 the dusty blue (2.69:1),
    // the baseline the axis grey (3.39:1) — all three below AA, at fontSize 10.
    // The rule directly under each label still carries the color, so the marker
    // reads the same while the text became legible.
    const { container } = renderRun()
    const labels = [...container.querySelectorAll('svg text')].filter((t) =>
      /^P(10|50|90)$/.test(t.textContent ?? ''),
    )
    expect(labels.length).toBe(3)

    // #5B5750 is the light-mode --ink-soft (7.18:1 on surface). jsdom has no
    // theme store toggled, so the light theme is what renders here.
    for (const label of labels) expect(label.getAttribute('fill')).toBe('#5B5750')

    // ...while the marker rules keep their palette colors — the point of the
    // split. Asserted together so "ink everything" cannot pass as the fix.
    const strokes = [...container.querySelectorAll('svg line')].map((l) => l.getAttribute('stroke'))
    expect(strokes).toContain('#0E9F6E')
  })

  it('shows nothing until the simulation is run', () => {
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
    expect(document.querySelector('svg text')).toBeNull()
  })
})
