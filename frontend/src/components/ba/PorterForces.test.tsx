import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PorterForces } from './PorterForces'
import type { BAContent } from '../../types'

const content: BAContent = {
  forces: [
    { key: 'rivalry', level: 'high', rationale: 'Çox oyunçu, aşağı fərqlənmə.' },
    { key: 'new_entrants', level: 'medium', rationale: 'Orta giriş baryeri.' },
    { key: 'substitutes', level: 'low', rationale: 'Yaxın əvəzedici yoxdur.' },
  ],
}

describe('PorterForces', () => {
  it('keeps the level color on the segments and the label on ink', () => {
    // The label used to be `style={{ color: meta.color }}`. As text in light mode
    // every level failed AA — high/#D87C6B 2.72:1, medium/#C9A36B 2.13:1,
    // low/#0E9F6E 3.07:1 — so moving only the danger one to a token would have
    // left two of three failing. The segments beside it still carry the hue.
    //
    // This needs a rendered assertion rather than the theme.contrast source scan:
    // the color arrives through a lookup table (`meta.color`), and that scan
    // only sees the direct `style={{ color: DANGER }}` form.
    const { container } = render(<PorterForces content={content} />)

    const colored = [...container.querySelectorAll('[style*="background"]')]
    expect(colored.length).toBeGreaterThan(0)

    // Selected structurally, not by translated text. A regex over label spellings
    // passed vacuously: the suite runs in `az`, and the fixture's own rationale
    // "Orta giriş baryeri." matched `^orta`, so the query returned a <p> and the
    // loop asserted that <p> had no inline style while checking none of the three
    // labels. Under any other locale it would have checked nothing at all.
    const labels = [...container.querySelectorAll('section > div > span > span:last-child')]
    expect(labels.length).toBe(3)
    expect(labels.map((l) => l.textContent)).not.toContain('')
    for (const label of labels) expect(label.getAttribute('style')).toBeNull()
  })

  it('renders one section per force with its rationale', () => {
    render(<PorterForces content={content} />)
    expect(screen.getByText('Çox oyunçu, aşağı fərqlənmə.')).toBeTruthy()
    expect(screen.getByTestId('porter-forces').children.length).toBe(3)
  })

  it('renders nothing without forces', () => {
    const { container } = render(<PorterForces content={{}} />)
    expect(container.querySelector('[data-testid="porter-forces"]')?.children.length).toBe(0)
  })
})
