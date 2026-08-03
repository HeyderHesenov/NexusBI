import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SourceSelect } from './SourceSelect'
import type { DataSource } from '../../types'

const sources: DataSource[] = [
  { id: 'a', name: 'Acme Postgres', db_type: 'postgresql', created_at: '2024-01-01T00:00:00Z' },
  { id: 'b', name: 'Sales CSV', db_type: 'sqlite', created_at: '2024-02-01T00:00:00Z' },
]

const setup = (props: Partial<React.ComponentProps<typeof SourceSelect>> = {}) => {
  const onChange = vi.fn()
  const utils = render(
    <SourceSelect
      value={null}
      onChange={onChange}
      label="Sorğunun işlədiyi mənbə"
      demoLabel="Demo data"
      sources={sources}
      {...props}
    />,
  )
  return { onChange, ...utils }
}

describe('SourceSelect', () => {
  it('lists demo data first, then every connected source', () => {
    setup()
    const options = screen.getAllByRole('option') as HTMLOptionElement[]
    expect(options.map((o) => o.textContent)).toEqual(['Demo data', 'Acme Postgres', 'Sales CSV'])
    expect(options[0].value).toBe('')
  })

  it('is reachable by its accessible name — the visible label is icon-only', () => {
    setup()
    expect(screen.getByLabelText('Sorğunun işlədiyi mənbə')).toBeInTheDocument()
  })

  it('reports a chosen source by id, and demo data as null', () => {
    const { onChange } = setup()
    const select = screen.getByLabelText('Sorğunun işlədiyi mənbə')

    fireEvent.change(select, { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('b')

    fireEvent.change(select, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  // Addressed by name and by exact class token, both deliberately. The chevron
  // is also an svg and also carries `text-ink-faint`, so `querySelector('svg')`
  // would go on passing after the Database icon was deleted; and `toContain`
  // would accept `text-accent-soft` as `text-accent`.
  const iconClasses = () =>
    (screen.getByTestId('source-icon').getAttribute('class') ?? '').split(/\s+/)

  it('spends accent on the icon only when the data is actually yours', () => {
    const { rerender } = setup()

    expect(iconClasses()).toContain('text-ink-faint')
    expect(iconClasses()).not.toContain('text-accent')

    rerender(
      <SourceSelect
        value="a"
        onChange={vi.fn()}
        label="Sorğunun işlədiyi mənbə"
        demoLabel="Demo data"
        sources={sources}
      />,
    )
    expect(iconClasses()).toContain('text-accent')
    expect(iconClasses()).not.toContain('text-ink-faint')
  })

  it('keeps the icon faint when the selected id no longer exists', () => {
    // A source deleted in another tab leaves a dangling id until the caller
    // reconciles; an accent icon there would claim data that is gone.
    setup({ value: 'deleted-id' })
    expect(iconClasses()).toContain('text-ink-faint')
    expect(iconClasses()).not.toContain('text-accent')
  })

  it('exposes the full source name on hover, since the visible one is capped', () => {
    setup({ value: 'a' })
    expect(screen.getByLabelText('Sorğunun işlədiyi mənbə')).toHaveAttribute('title', 'Acme Postgres')
  })

  it('speaks the toolbar dialect by default and the form dialect on request', () => {
    const { container, unmount } = setup()
    expect(container.firstElementChild?.className).toContain('rounded-lg')
    expect(screen.getByLabelText('Sorğunun işlədiyi mənbə').className).toContain('text-xs')
    unmount()

    const field = setup({ size: 'field' })
    expect(field.container.firstElementChild?.className).toContain('rounded-xl')
    expect(screen.getByLabelText('Sorğunun işlədiyi mənbə').className).toContain('text-sm')
  })

  it('states its width instead of inheriting it from the longest source name', () => {
    // A select shrink-to-fits to its widest option, so a cap alone let the
    // control resize when load() resolved — and stay wide on "Demo data".
    const { unmount } = setup()
    expect(screen.getByLabelText('Sorğunun işlədiyi mənbə').className).toContain('w-[180px]')
    unmount()

    setup({ size: 'field' })
    expect(screen.getByLabelText('Sorğunun işlədiyi mənbə').className).toContain('w-[240px]')
  })

  it('overrides the browser dropdown chrome so the control owns its height', () => {
    setup()
    // Without appearance-none the UA decides the select's height and the whole
    // toolbar row goes out of alignment.
    expect(screen.getByLabelText('Sorğunun işlədiyi mənbə').className).toContain('appearance-none')
  })

  it('renders a trailing slot inside the shell, and nothing when omitted', () => {
    const { container, rerender } = setup()
    expect(screen.queryByTestId('trailing')).not.toBeInTheDocument()

    rerender(
      <SourceSelect
        value={null}
        onChange={vi.fn()}
        label="Sorğunun işlədiyi mənbə"
        demoLabel="Demo data"
        sources={sources}
        trailing={<span data-testid="trailing">əlavə et</span>}
      />,
    )
    expect(screen.getByTestId('trailing')).toBeInTheDocument()
    // One shared border around both segments, split by a hairline.
    expect(container.querySelector('.w-px')).toBeInTheDocument()
  })
})
