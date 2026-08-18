import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ImpactStatus } from '../../types'
import { IMPACT, ImpactBadge } from './ImpactBadge'

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts).
const LABELS: Record<ImpactStatus, string> = {
  pending: 'Gözləyir',
  on_track: 'İrəliləyir',
  achieved: 'Nail olundu',
  missed: 'Çatmadı',
  regressed: 'Geriləyir',
}

describe('ImpactBadge', () => {
  it.each(Object.keys(LABELS) as ImpactStatus[])('renders %s in words', (status) => {
    render(<ImpactBadge status={status} />)
    expect(screen.getByText(LABELS[status])).toBeInTheDocument()
  })

  it('covers every impact status the API can return', () => {
    // Written out rather than derived from IMPACT — a list built from the thing
    // it checks agrees with itself no matter what either one says.
    expect(Object.keys(IMPACT).sort()).toEqual(
      ['achieved', 'missed', 'on_track', 'pending', 'regressed'],
    )
  })

  it('keeps the three verdicts visually distinct from each other', () => {
    // Not a colour-quality check (that is charts/theme.test.ts's job) — just
    // that the move did not collapse two verdicts onto one style, which would
    // read as "achieved" and "regressed" being the same thing.
    const styles = Object.values(IMPACT).map((i) => i.cls)
    expect(new Set(styles).size).toBe(styles.length)
  })
})
