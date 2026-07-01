import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewMenu } from './ViewMenu'

describe('ViewMenu', () => {
  it('renders the "Görünüş" trigger and opens the 7 chart types', () => {
    render(<ViewMenu value="bar" onChange={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Görünüş' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(7)
  })

  it('marks the current type active (checked) and fires onChange on select', () => {
    const onChange = vi.fn()
    render(<ViewMenu value="bar" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Görünüş' }))
    // current "Sütun" (bar) row carries the accent/check styling
    const current = screen.getByRole('menuitem', { name: /Sütun/ })
    expect(current.className).toContain('text-accent')
    expect(current).toHaveAttribute('aria-current', 'true') // active conveyed to AT
    expect(screen.getByRole('menuitem', { name: /Xətt/ })).not.toHaveAttribute('aria-current')
    fireEvent.click(screen.getByRole('menuitem', { name: /Xətt/ }))
    expect(onChange).toHaveBeenCalledWith('line')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
