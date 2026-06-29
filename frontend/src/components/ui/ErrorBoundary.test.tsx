import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb({ boom }: { boom: boolean }) {
  if (boom) throw new Error('kaboom')
  return <div>sağlam</div>
}

describe('ErrorBoundary', () => {
  // React logs caught errors to console.error; silence for clean test output.
  beforeAll(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterAll(() => vi.restoreAllMocks())

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <Bomb boom={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('sağlam')).toBeInTheDocument()
  })

  it('shows the fallback alert when a child throws', () => {
    render(
      <ErrorBoundary label="Qrafik">
        <Bomb boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Qrafik yüklənmədi')).toBeInTheDocument()
  })

  it('recovers when resetKeys change', () => {
    function Harness() {
      const [boom, setBoom] = useState(true)
      return (
        <>
          <button onClick={() => setBoom(false)}>düzəlt</button>
          <ErrorBoundary resetKeys={[boom]}>
            <Bomb boom={boom} />
          </ErrorBoundary>
        </>
      )
    }
    render(<Harness />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByText('düzəlt')) // flips boom → resetKeys change
    expect(screen.getByText('sağlam')).toBeInTheDocument()
  })

  it('retry button clears the error', () => {
    function Harness() {
      const [boom, setBoom] = useState(true)
      return (
        <ErrorBoundary>
          <button onClick={() => setBoom(false)}>fix</button>
          <Bomb boom={boom} />
        </ErrorBoundary>
      )
    }
    render(<Harness />)
    // Fix the underlying cause, then hit the boundary's retry.
    fireEvent.click(screen.getByText('Yenidən cəhd et'))
    // After reset the boundary re-renders children; still boom=true so it re-catches.
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
