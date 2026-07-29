import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChartFullscreenModal } from './ChartFullscreenModal'

afterEach(() => {
  document.body.style.overflow = ''
})

describe('ChartFullscreenModal a11y', () => {
  it('portals out of its mount point', () => {
    // Chat share cards open this from inside a `max-w-[75%] overflow-hidden
    // bg-accent` bubble — rendering inline would clip and recolor the dialog.
    render(
      <div data-testid="host">
        <ChartFullscreenModal open onClose={() => {}} title="Qrafik başlıq">
          <button>İçəri</button>
        </ChartFullscreenModal>
      </div>,
    )
    expect(screen.getByTestId('host').contains(screen.getByRole('dialog'))).toBe(false)
    expect(document.body.contains(screen.getByRole('dialog'))).toBe(true)
  })

  it('exposes the dialog role and labels it by the title', () => {
    render(
      <ChartFullscreenModal open onClose={() => {}} title="Qrafik başlıq">
        <button>İçəri</button>
      </ChartFullscreenModal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Qrafik başlıq')
  })

  it('falls back to a generic accessible name when no title is given', () => {
    render(
      <ChartFullscreenModal open onClose={() => {}}>
        <button>İçəri</button>
      </ChartFullscreenModal>,
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Qrafik')
  })

  it('locks body scroll while open and restores on close', () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <ChartFullscreenModal open={open} onClose={() => setOpen(false)} title="X">
          <button>İçəri</button>
        </ChartFullscreenModal>
      )
    }
    render(<Harness />)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('')
  })

  it('moves initial focus into the dialog', () => {
    render(
      <ChartFullscreenModal open onClose={() => {}} title="X">
        <button>İçəri</button>
      </ChartFullscreenModal>,
    )
    // Close sits in the header, ahead of the body — so it is the first focusable.
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    expect(screen.getByRole('button', { name: 'Bağla' })).toHaveFocus()
  })

  it('traps Tab focus inside the dialog (wraps last → first)', () => {
    render(
      <ChartFullscreenModal open onClose={() => {}} title="X">
        <button>Bir</button>
      </ChartFullscreenModal>,
    )
    // Focus order is [Bağla (header), Bir (body)] — Tab off the last wraps to the first.
    screen.getByText('Bir').focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Bağla' })).toHaveFocus()
  })

  it('restores focus to the trigger on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Böyüt</button>
          <ChartFullscreenModal open={open} onClose={() => setOpen(false)} title="X">
            <span>Qrafik gövdəsi</span>
          </ChartFullscreenModal>
        </>
      )
    }
    render(<Harness />)
    const trigger = screen.getByText('Böyüt')
    // userEvent, not fireEvent: only the former focuses the trigger on click the
    // way a real browser does, which is what focus restoration reads back.
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(trigger).toHaveFocus()
  })

  it('Escape triggers onClose', () => {
    const onClose = vi.fn()
    render(
      <ChartFullscreenModal open onClose={onClose} title="X">
        <button>İçəri</button>
      </ChartFullscreenModal>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('backdrop click closes but a click inside the card does not', () => {
    const onClose = vi.fn()
    render(
      <ChartFullscreenModal open onClose={onClose} title="X">
        <button>İçəri</button>
      </ChartFullscreenModal>,
    )
    fireEvent.click(screen.getByText('İçəri'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders nothing when closed', () => {
    render(
      <ChartFullscreenModal open={false} onClose={() => {}} title="X">
        <button>İçəri</button>
      </ChartFullscreenModal>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
