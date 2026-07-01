import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActionMenu, type ActionMenuSection } from './ActionMenu'

function sections(onA = () => {}, onB = () => {}, onC = () => {}): ActionMenuSection[] {
  return [
    { header: 'Group 1', items: [{ key: 'a', label: 'Alpha', onSelect: onA, active: true }] },
    {
      header: 'Group 2',
      items: [
        { key: 'b', label: 'Beta', onSelect: onB, disabled: true },
        { key: 'c', label: 'Gamma', onSelect: onC },
      ],
    },
  ]
}

describe('ActionMenu', () => {
  it('is collapsed initially and opens on trigger click, rendering all rows', () => {
    render(<ActionMenu ariaLabel="tools" triggerLabel="Tools" sections={sections()} />)
    const trigger = screen.getByRole('button', { name: 'tools' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
    expect(screen.getByText('Group 1')).toBeInTheDocument()
    expect(screen.getByText('Group 2')).toBeInTheDocument()
  })

  it('fires onSelect and closes on click', () => {
    const onC = vi.fn()
    render(<ActionMenu ariaLabel="tools" triggerLabel="Tools" sections={sections(() => {}, () => {}, onC)} />)
    fireEvent.click(screen.getByRole('button', { name: 'tools' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Gamma' }))
    expect(onC).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not fire a disabled row', () => {
    const onB = vi.fn()
    render(<ActionMenu ariaLabel="tools" triggerLabel="Tools" sections={sections(() => {}, onB)} />)
    fireEvent.click(screen.getByRole('button', { name: 'tools' }))
    const beta = screen.getByRole('menuitem', { name: 'Beta' })
    expect(beta).toBeDisabled()
    fireEvent.click(beta)
    expect(onB).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('shows the count badge (capped) only when > 0', () => {
    const { rerender } = render(
      <ActionMenu ariaLabel="tools" triggerLabel="Tools" count={0} sections={sections()} />,
    )
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    rerender(<ActionMenu ariaLabel="tools" triggerLabel="Tools" count={12} sections={sections()} />)
    expect(screen.getByText('9+')).toBeInTheDocument()
  })

  it('closes on Escape and on outside click', () => {
    render(
      <div>
        <ActionMenu ariaLabel="tools" triggerLabel="Tools" sections={sections()} />
        <button>outside</button>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'tools' })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('keyboard: ArrowDown opens then skips the disabled row, Enter fires', () => {
    const onA = vi.fn()
    const onC = vi.fn()
    render(<ActionMenu ariaLabel="tools" triggerLabel="Tools" sections={sections(onA, () => {}, onC)} />)
    const trigger = screen.getByRole('button', { name: 'tools' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // open, active = Alpha (0)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // skips disabled Beta → Gamma (2)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onC).toHaveBeenCalledTimes(1)
    expect(onA).not.toHaveBeenCalled()
  })

  it('groups rows into role="group" sections labelled by the header', () => {
    render(<ActionMenu ariaLabel="tools" triggerLabel="Tools" sections={sections()} />)
    fireEvent.click(screen.getByRole('button', { name: 'tools' }))
    const groups = screen.getAllByRole('group')
    expect(groups).toHaveLength(2)
    expect(screen.getByRole('group', { name: 'Group 1' })).toBeInTheDocument()
  })

  it('drops aria-activedescendant when every row is disabled', () => {
    const allDisabled: ActionMenuSection[] = [
      { header: 'G', items: [{ key: 'x', label: 'X', onSelect: () => {}, disabled: true }] },
    ]
    render(<ActionMenu ariaLabel="tools" triggerLabel="Tools" sections={allDisabled} />)
    const trigger = screen.getByRole('button', { name: 'tools' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(trigger).not.toHaveAttribute('aria-activedescendant')
  })

  it('aria: trigger exposes activedescendant + controls when open', () => {
    render(<ActionMenu ariaLabel="tools" triggerLabel="Tools" sections={sections()} />)
    const trigger = screen.getByRole('button', { name: 'tools' })
    expect(trigger).not.toHaveAttribute('aria-activedescendant')
    fireEvent.click(trigger)
    const menuId = trigger.getAttribute('aria-controls')
    expect(menuId).toBeTruthy()
    expect(screen.getByRole('menu')).toHaveAttribute('id', menuId)
    expect(trigger.getAttribute('aria-activedescendant')).toMatch(/-item-0$/)
  })
})
