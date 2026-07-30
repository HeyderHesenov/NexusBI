import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useReflowDismiss } from './useReflowDismiss'

// jsdom reports a zero rect for everything, so the anchor's position is driven
// from here: `rect` is what the anchor "currently" measures.
let rect = { top: 100, left: 0 }
const rectOf = () =>
  ({ ...rect, bottom: rect.top + 20, right: 80, width: 80, height: 20 }) as DOMRect

beforeEach(() => {
  rect = { top: 100, left: 0 }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(rectOf)
})
afterEach(() => vi.restoreAllMocks())

function Harness({
  active = true,
  onDismiss,
  anchored = false,
  ignoring = false,
}: {
  active?: boolean
  onDismiss: () => void
  anchored?: boolean
  ignoring?: boolean
}) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useReflowDismiss(active, onDismiss, {
    anchorRef: anchored ? anchorRef : undefined,
    ignoreWithin: ignoring ? panelRef : undefined,
  })
  return (
    <div>
      <button ref={anchorRef}>anchor</button>
      <div ref={panelRef} data-testid="panel">
        <span data-testid="row">row</span>
      </div>
    </div>
  )
}

describe('useReflowDismiss', () => {
  it('ignores the scroll that brought the anchor into view, dismisses once it moves', () => {
    // The PR #12 regression: a driver scrolls the trigger into view and clicks it,
    // and the browser delivers that scroll event a frame later — with the panel
    // already open. By then the scroll is baked into the layout, so the anchor
    // has not moved and the panel must stay put.
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} anchored />)

    fireEvent.scroll(document)
    expect(onDismiss).not.toHaveBeenCalled()

    rect = { top: 40, left: 0 }
    fireEvent.scroll(document)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('dismisses on any scroll when there is no anchor to track', () => {
    // Cursor-anchored menus (ContextMenu, the dashboard pill menu) keep the
    // blunt behaviour: nothing identifies "their" content, so any scroll strands them.
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} />)
    fireEvent.scroll(document)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not listen at all while inactive', () => {
    const onDismiss = vi.fn()
    render(<Harness active={false} onDismiss={onDismiss} />)
    fireEvent.scroll(document)
    fireEvent.resize(window)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores scrolling inside the panel itself', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} ignoring />)
    fireEvent.scroll(screen.getByTestId('row'))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.scroll(document)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('always dismisses on resize, moved or not', () => {
    const onDismiss = vi.fn()
    render(<Harness onDismiss={onDismiss} anchored />)
    fireEvent.resize(window)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('detaches on unmount and on going inactive', () => {
    const onDismiss = vi.fn()
    const { unmount, rerender } = render(<Harness onDismiss={onDismiss} />)

    rerender(<Harness active={false} onDismiss={onDismiss} />)
    fireEvent.scroll(document)
    expect(onDismiss).not.toHaveBeenCalled()

    rerender(<Harness onDismiss={onDismiss} />)
    unmount()
    fireEvent.scroll(document)
    fireEvent.resize(window)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
