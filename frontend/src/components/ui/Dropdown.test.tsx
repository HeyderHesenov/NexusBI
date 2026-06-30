import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Dropdown, type DropdownOption } from './Dropdown'

type V = 'all' | 'a' | 'b'
const opts: DropdownOption<V>[] = [
  { value: 'all', label: 'Hamısı', count: 7 },
  { value: 'a', label: 'Alpha', count: 0 },
  { value: 'b', label: 'Beta', count: 12 },
]

describe('Dropdown', () => {
  it('is collapsed initially and opens on trigger click', () => {
    render(<Dropdown ariaLabel="f" options={opts} value="all" onChange={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'f' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('shows count badges (capped) and hides zero counts', () => {
    render(<Dropdown ariaLabel="f" options={opts} value="all" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'f' }))
    expect(screen.getByText('9+')).toBeInTheDocument() // 12 capped, in the menu
    // count 7 shows on both the trigger and the "Hamısı" option; zero count hidden
    expect(screen.getAllByText('7').length).toBeGreaterThan(0)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('selects an option, fires onChange and closes', () => {
    const onChange = vi.fn()
    render(<Dropdown ariaLabel="f" options={opts} value="all" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'f' }))
    fireEvent.click(screen.getByRole('option', { name: /Beta/ }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on Escape and on outside click', () => {
    render(
      <div>
        <Dropdown ariaLabel="f" options={opts} value="all" onChange={() => {}} />
        <button>outside</button>
      </div>,
    )
    const trigger = screen.getByRole('button', { name: 'f' })
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keyboard: ArrowDown opens, ArrowDown moves, Enter selects', () => {
    function Harness() {
      const [v, setV] = useState<V>('all')
      return <Dropdown ariaLabel="f" options={opts} value={v} onChange={setV} />
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'f' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // opens, active=0 (all)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // active=1 (Alpha)
    fireEvent.keyDown(trigger, { key: 'Enter' }) // select Alpha
    expect(trigger).toHaveTextContent('Alpha')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keyboard: ArrowUp wraps to the last option', () => {
    function Harness() {
      const [v, setV] = useState<V>('all')
      return <Dropdown ariaLabel="f" options={opts} value={v} onChange={setV} />
    }
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'f' })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }) // open, active=0
    fireEvent.keyDown(trigger, { key: 'ArrowUp' }) // wraps to last (index 2 = Beta)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger).toHaveTextContent('Beta')
  })

  it('aria: trigger exposes activedescendant + controls when open', () => {
    render(<Dropdown ariaLabel="f" options={opts} value="all" onChange={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'f' })
    expect(trigger).not.toHaveAttribute('aria-activedescendant')
    fireEvent.click(trigger)
    const listId = trigger.getAttribute('aria-controls')
    expect(listId).toBeTruthy()
    expect(screen.getByRole('listbox')).toHaveAttribute('id', listId)
    expect(trigger.getAttribute('aria-activedescendant')).toMatch(/-opt-0$/)
  })
})
