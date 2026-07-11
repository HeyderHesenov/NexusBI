import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RevealText } from './RevealText'

describe('RevealText', () => {
  it('renders the full text at once (no character-by-character reveal)', () => {
    render(<RevealText text="Satış son ayda 12% artdı." />)
    // Whole string is present immediately — not a growing slice.
    expect(screen.getByText('Satış son ayda 12% artdı.')).toBeInTheDocument()
  })

  it('applies the fade-in class alongside any passed className', () => {
    render(<RevealText text="hello" className="text-sm text-ink" />)
    const p = screen.getByText('hello')
    expect(p).toHaveClass('fade-in')
    expect(p).toHaveClass('text-sm')
    expect(p).toHaveClass('text-ink')
  })

  it('fires onType once when the text changes', () => {
    const onType = vi.fn()
    const { rerender } = render(<RevealText text="first" onType={onType} />)
    expect(onType).toHaveBeenCalledTimes(1)
    rerender(<RevealText text="second" onType={onType} />)
    expect(onType).toHaveBeenCalledTimes(2)
    // Re-render with the same text does not re-fire.
    rerender(<RevealText text="second" onType={onType} />)
    expect(onType).toHaveBeenCalledTimes(2)
  })
})
