import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Segmented, type SegmentedOption } from './Segmented'

type V = 'all' | 'a' | 'b'
const opts: SegmentedOption<V>[] = [
  { value: 'all', label: 'Hamısı', count: 3 },
  { value: 'a', label: 'A', count: 0 },
  { value: 'b', label: 'B', count: 12 },
]

describe('Segmented', () => {
  it('renders a radiogroup with one checked radio and count badges', () => {
    render(<Segmented ariaLabel="f" options={opts} value="all" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('f')
    expect(screen.getByRole('radio', { name: /Hamısı/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('9+')).toBeInTheDocument() // 12 is capped
    expect(screen.queryByText('0')).not.toBeInTheDocument() // zero counts hide
  })

  it('calls onChange when a chip is clicked', () => {
    const onChange = vi.fn()
    render(<Segmented ariaLabel="f" options={opts} value="all" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: /B/ }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('moves selection with arrow keys and wraps around', () => {
    function Harness() {
      const [v, setV] = useState<V>('all')
      return <Segmented ariaLabel="f" options={opts} value={v} onChange={setV} />
    }
    render(<Harness />)
    const first = screen.getByRole('radio', { name: /Hamısı/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowLeft' }) // wraps to last
    expect(screen.getByRole('radio', { name: /B/ })).toHaveAttribute('aria-checked', 'true')
  })
})
