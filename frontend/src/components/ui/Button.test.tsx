import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('renders children and defaults type to "button" (never an accidental submit)', () => {
    render(<Button>Save</Button>)
    const btn = screen.getByRole('button', { name: 'Save' })
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.className).toContain('bg-accent') // primary is the default variant
  })

  it('maps each variant to a distinct class', () => {
    const { rerender } = render(<Button variant="secondary">X</Button>)
    expect(screen.getByRole('button').className).toContain('border-line')
    rerender(<Button variant="danger">X</Button>)
    expect(screen.getByRole('button').className).toContain('#D87C6B')
    rerender(<Button variant="ghost">X</Button>)
    expect(screen.getByRole('button').className).not.toContain('bg-accent')
  })

  it('loading disables the button and marks aria-busy', () => {
    render(<Button loading>Run</Button>)
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.getAttribute('aria-busy')).toBe('true')
  })

  it('respects an explicit disabled prop', () => {
    render(<Button disabled>Nope</Button>)
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps an explicit type override (e.g. submit)', () => {
    render(<Button type="submit">Go</Button>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('submit')
  })
})
