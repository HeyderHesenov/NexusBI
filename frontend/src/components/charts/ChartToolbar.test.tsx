import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChartToolbar } from './ChartToolbar'

describe('ChartToolbar', () => {
  it('renders the 7 chart-type buttons', () => {
    render(<ChartToolbar value="bar" onChange={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Sütun' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pivot' })).toBeInTheDocument()
  })

  it('marks the current type pressed and fires onChange on select', () => {
    const onChange = vi.fn()
    render(<ChartToolbar value="bar" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Sütun' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Xətt' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Xətt' }))
    expect(onChange).toHaveBeenCalledWith('line')
  })
})
