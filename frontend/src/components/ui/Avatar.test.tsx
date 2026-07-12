import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('uses the first letter of the name, uppercased', () => {
    render(<Avatar name="ayşe" email="ignored@x.io" />)
    expect(screen.getByText('A')).toBeTruthy()
  })

  it('falls back to email when no name is given', () => {
    render(<Avatar email="zaur@nexusbi.io" />)
    expect(screen.getByText('Z')).toBeTruthy()
  })

  it('renders "?" when neither name nor email is present', () => {
    render(<Avatar />)
    expect(screen.getByText('?')).toBeTruthy()
  })

  it('honours the size variant', () => {
    const { container } = render(<Avatar name="Ada" size="sm" />)
    expect(container.querySelector('span')?.className).toContain('h-7')
  })
})
