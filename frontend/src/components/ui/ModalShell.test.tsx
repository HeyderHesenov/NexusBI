import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModalShell } from './ModalShell'

afterEach(() => {
  document.body.style.overflow = ''
})

describe('ModalShell a11y', () => {
  it('exposes the dialog role and labels it by the title', () => {
    render(
      <ModalShell open onClose={() => {}} title="Test başlıq">
        <button>İçəri</button>
      </ModalShell>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Test başlıq')
  })

  it('locks body scroll while open and restores on close', () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <ModalShell open={open} onClose={() => setOpen(false)} title="X">
          <button>İçəri</button>
        </ModalShell>
      )
    }
    render(<Harness />)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('')
  })

  it('moves initial focus into the dialog', () => {
    render(
      <ModalShell open onClose={() => {}} title="X">
        <button>İlk</button>
      </ModalShell>,
    )
    expect(screen.getByText('İlk')).toHaveFocus()
  })

  it('traps Tab focus inside the dialog (wraps last → first)', () => {
    render(
      <ModalShell open onClose={() => {}} title="X">
        <button>Bir</button>
        <button>İki</button>
      </ModalShell>,
    )
    const last = screen.getByText('İki')
    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByText('Bir')).toHaveFocus()
  })

  it('Escape triggers onClose', () => {
    const onClose = vi.fn()
    render(
      <ModalShell open onClose={onClose} title="X">
        <button>İçəri</button>
      </ModalShell>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
