import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  const open = () =>
    render(
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Sil"
        message="Bu əməliyyat geri qaytarıla bilməz."
        confirmLabel="Sil"
      />,
    )

  it('puts the destructive button label on --bg, not white', () => {
    // `text-white` on `bg-danger` passed in light mode (5.58:1) and failed in
    // dark (2.99:1) — the dark `--danger` is the lighter salmon, so white text
    // sits on top of it. `--bg` follows the theme and clears AA in both
    // directions (light 5.29, dark 6.04). Asserted as a class rather than a
    // computed ratio because jsdom resolves neither Tailwind nor the custom
    // properties; the ratios themselves were measured outside the suite.
    open()
    const button = screen.getByRole('button', { name: 'Sil' })
    expect(button.className).toContain('text-bg')
    expect(button.className).not.toContain('text-white')
    expect(button.className).toContain('bg-danger')
  })

  it('changes the fill on hover rather than the whole element opacity', () => {
    // `hover:opacity-90` fades the label with the fill: the hovered pair measures
    // 4.39:1 in light mode, so the button passed at rest and failed on hover.
    // `--danger-press` darkens only the fill (7.24 light / 4.91 dark).
    // `disabled:opacity-60` is intentionally still allowed — WCAG 1.4.3 exempts
    // inactive controls — so this pins the hover state alone.
    open()
    const button = screen.getByRole('button', { name: 'Sil' })
    expect(button.className).toContain('hover:bg-danger-press')
    expect(button.className).not.toContain('hover:opacity')
  })

  it('renders the message and a cancel affordance', () => {
    open()
    expect(screen.getByText('Bu əməliyyat geri qaytarıla bilməz.')).toBeTruthy()
    // Two buttons: the destructive one and a way out that is not it.
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2)
  })
})
