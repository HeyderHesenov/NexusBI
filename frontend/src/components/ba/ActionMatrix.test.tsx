import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ActionMatrix } from './ActionMatrix'
import type { BAAction } from '../../types'

const actions: BAAction[] = [
  { text: 'Big bet', impact: 5, effort: 5, derived: false },
  { text: 'Quick win', impact: 5, effort: 1, derived: true },
  { text: 'Thankless', impact: 1, effort: 5, derived: true },
]

const renderMatrix = (a: BAAction[], onPromote = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <MemoryRouter>
      <ActionMatrix actions={a} onPromote={onPromote} />
    </MemoryRouter>,
  )
  return onPromote
}

describe('ActionMatrix', () => {
  it('places each action in its impact × effort quadrant', () => {
    renderMatrix(actions)
    const cells = screen.getByTestId('ba-action-matrix').querySelectorAll(':scope > div > div')
    const textOf = (i: number) => cells[i].textContent ?? ''
    expect(textOf(0)).toContain('Quick win') // high impact, low effort
    expect(textOf(1)).toContain('Big bet') // high impact, high effort
    expect(textOf(3)).toContain('Thankless') // low impact, high effort
  })

  it('lists actions by impact minus effort, descending', () => {
    renderMatrix(actions)
    const rows = screen.getByTestId('ba-action-matrix').querySelectorAll('ul + ul > li, ul:last-of-type > li')
    const texts = Array.from(rows).map((r) => r.textContent ?? '')
    expect(texts[0]).toContain('Quick win')
    expect(texts[texts.length - 1]).toContain('Thankless')
  })

  it('promotes using the ORIGINAL index, not the display order', async () => {
    // 'Quick win' sorts first but is stored at index 1 — promoting the top row
    // must address index 1, or the wrong action becomes a decision.
    const onPromote = renderMatrix(actions)
    await userEvent.click(screen.getAllByRole('button', { name: /Qərara çevir/ })[0])
    await waitFor(() => expect(onPromote).toHaveBeenCalledWith(1))
  })

  it('shows a link instead of a button once promoted', () => {
    renderMatrix([{ text: 'Done', impact: 4, effort: 2, decision_id: 'd-1' }])
    expect(screen.getByRole('link', { name: /Qərara keç/ }).getAttribute('href')).toBe(
      '/decisions',
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('marks AI-estimated scores so they are not read as measured', () => {
    renderMatrix([{ text: 'Guess', impact: 4, effort: 2, derived: false }])
    expect(screen.getByText(/AI qiyməti/)).toBeTruthy()
  })

  it('does not mark derived scores as AI estimates', () => {
    renderMatrix([{ text: 'Ruled', impact: 4, effort: 2, derived: true }])
    expect(screen.queryByText(/AI qiyməti/)).toBeNull()
  })

  it('disables every promote button while one is in flight', async () => {
    let release: (() => void) | undefined
    const onPromote = vi.fn(() => new Promise<void>((r) => (release = r)))
    renderMatrix(actions, onPromote as never)
    const buttons = screen.getAllByRole('button')
    await userEvent.click(buttons[0])
    await waitFor(() => expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true))
    release?.()
    await waitFor(() => expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true))
  })

  it('shows an empty message rather than an empty grid', () => {
    renderMatrix([])
    expect(screen.getByText('Bu artefakt üçün addım çıxarılmadı.')).toBeTruthy()
    expect(screen.queryByTestId('ba-action-matrix')).toBeNull()
  })
})
