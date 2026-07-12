import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ whiteLabel: true as boolean | undefined }))

vi.mock('../store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { white_label: boolean | undefined } }) => unknown) =>
    sel({ user: { white_label: h.whiteLabel } }),
}))
vi.mock('../api/branding', () => ({
  getBrand: vi.fn().mockResolvedValue({ app_name: 'NexusBI', primary_color: '#0E9F6E', logo_url: '' }),
  putBrand: vi.fn().mockResolvedValue({ app_name: 'Acme', primary_color: '#0E9F6E', logo_url: '' }),
}))
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

import { BrandingPage } from './BrandingPage'

const renderPage = () =>
  render(
    <MemoryRouter>
      <BrandingPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  h.whiteLabel = true
})

describe('BrandingPage', () => {
  it('locks white-label behind a paid plan and links to pricing', () => {
    h.whiteLabel = false
    renderPage()
    expect(screen.getByText(/Pro özəlliyidir/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Pro plana keç/ })).toHaveAttribute('href', '/pricing')
  })

  it('disables save until a valid change is made', async () => {
    renderPage()
    const name = await screen.findByLabelText('Tətbiq adı')
    const save = screen.getByRole('button', { name: /Yadda saxla/ })
    expect(save).toBeDisabled() // pristine
    fireEvent.change(name, { target: { value: 'Acme BI' } })
    expect(save).toBeEnabled() // dirty + valid
  })

  it('flags an invalid hex color and keeps save disabled', async () => {
    renderPage()
    await screen.findByLabelText('Tətbiq adı')
    fireEvent.change(screen.getByLabelText('Əsas rəng'), { target: { value: 'nope' } })
    expect(screen.getByRole('alert')).toHaveTextContent('#RRGGBB')
    expect(screen.getByRole('button', { name: /Yadda saxla/ })).toBeDisabled()
  })

  it('warns on a low-contrast color with an icon, not an emoji', async () => {
    renderPage()
    const color = await screen.findByLabelText('Əsas rəng')
    // Valid hex, but fails the 3:1 both-themes check (yellow disappears on white).
    fireEvent.change(color, { target: { value: '#FFFF00' } })
    expect(screen.getByText('Zəif kontrast')).toBeInTheDocument()
    expect(screen.queryByText(/[⚠✓]/)).toBeNull()
  })
})
