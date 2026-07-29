import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ShareMeta } from '../../api/chat'
import type { ChartType } from '../../types'
import { ShareCard } from './ShareCard'

// THE GUARD: recharts (~440kB) must not reach the chat thread. Any static or
// transitive import of it on ShareCard's path runs this factory at import time
// and flips the flag — so every render assertion below doubles as a bundle test.
// It loads only when someone opens the dialog, which this file never does with
// the real renderer mounted.
const rc = vi.hoisted(() => ({ loaded: false }))
vi.mock('recharts', async (importOriginal) => {
  rc.loaded = true
  return importOriginal()
})

// A render probe INSIDE ShareCard's subtree, for the memo test below. It wraps the
// REAL ChartPreview rather than replacing it, so the recharts guard above still
// sees whatever the genuine preview path imports.
const preview = vi.hoisted(() => ({ renders: 0 }))
vi.mock('../charts/previews/ChartPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../charts/previews/ChartPreview')>()
  return {
    ChartPreview: (props: Parameters<typeof actual.ChartPreview>[0]) => {
      preview.renders++
      return <actual.ChartPreview {...props} />
    },
  }
})

const rows = [
  { city: 'Bakı', revenue: 120 },
  { city: 'Gəncə', revenue: 60 },
  { city: 'Sumqayıt', revenue: 45 },
]

const meta = (over: Partial<ShareMeta> = {}): ShareMeta =>
  ({
    kind: 'share',
    resource_type: 'query_log',
    resource_id: 'q1',
    caption: '',
    title: 'Rayonlar üzrə gəlir',
    chart: {
      chart_type: 'bar',
      chart_config: { chart_type: 'bar', x_axis: 'city', y_axis: 'revenue', color_by: null },
      columns: ['city', 'revenue'],
      data: rows,
    },
    ...over,
  }) as ShareMeta

const withChart = (chart_type: ChartType, over: Record<string, unknown> = {}) =>
  meta({
    chart: {
      chart_type,
      chart_config: { chart_type, x_axis: 'city', y_axis: 'revenue', color_by: null },
      columns: ['city', 'revenue'],
      data: rows,
      ...over,
    },
  } as Partial<ShareMeta>)

const draw = (m = meta(), canOpen = false, onOpen = vi.fn()) =>
  render(<ShareCard meta={m} canOpen={canOpen} onOpen={onOpen} />)

const expandBtn = () => screen.getByRole('button', { name: /böyüt/i })

describe('ShareCard — recharts stays out of the chat thread', () => {
  const FAMILIES: ChartType[] = [
    'bar',
    'line',
    'area',
    'pie',
    'scatter',
    'table',
    'pivot',
    'kpi_card',
  ]

  it.each(FAMILIES)('renders a %s share without loading recharts', (type) => {
    draw(withChart(type))
    expect(expandBtn()).toBeInTheDocument()
    expect(rc.loaded).toBe(false)
  })

  it('renders a reference card (no chart) without loading recharts', () => {
    draw(meta({ resource_type: 'dashboard', chart: null }))
    expect(rc.loaded).toBe(false)
  })
})

describe('ShareCard — the expand affordance', () => {
  it('is offered to recipients, not just the sharer', () => {
    // The snapshot is already in their client; the card is just too small to read.
    draw(meta(), false)
    expect(expandBtn()).toBeInTheDocument()
  })

  it('names itself for screen readers', () => {
    draw()
    expect(expandBtn()).toHaveAccessibleName('Rayonlar üzrə gəlir — qrafiki böyüt')
  })

  it('keeps the decorative preview out of the a11y tree', () => {
    draw()
    expect(expandBtn().querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it.each(['{Enter}', ' '] as const)('opens the dialog with the %s key', async (key) => {
    draw()
    expandBtn().focus()
    await userEvent.keyboard(key)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('opens on click and closes on Escape', async () => {
    draw()
    await userEvent.click(expandBtn())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not exist when the share carries no chart', () => {
    draw(meta({ resource_type: 'decision', chart: null }))
    expect(screen.queryByRole('button', { name: /böyüt/i })).toBeNull()
  })

  it('does not exist when the snapshot is empty — no phantom click target', () => {
    draw(withChart('bar', { data: [] }))
    expect(screen.queryByRole('button', { name: /böyüt/i })).toBeNull()
  })
})

describe('ShareCard — no nested interactive', () => {
  it('the expand button contains no other button', () => {
    draw(meta(), true)
    expect(within(expandBtn()).queryAllByRole('button')).toHaveLength(0)
  })

  it('the "open" chip is its own top-level button beside the preview', () => {
    draw(meta(), true)
    const chip = screen.getByRole('button', { name: /Aç/ })
    expect(expandBtn().contains(chip)).toBe(false)
  })
})

describe('ShareCard — the owner-only "open" chip', () => {
  it('is hidden from recipients', () => {
    draw(meta(), false)
    expect(screen.queryByRole('button', { name: /Aç/ })).toBeNull()
  })

  it('navigates for the sharer and does not open the dialog', async () => {
    const onOpen = vi.fn()
    draw(meta(), true, onOpen)
    await userEvent.click(screen.getByRole('button', { name: /Aç/ }))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ShareCard — truncation', () => {
  it('says so when the server dropped rows', () => {
    draw(withChart('bar', { truncated: true }))
    expect(screen.getByText('İlk 3 sətir göstərilir')).toBeInTheDocument()
  })

  it('stays quiet otherwise', () => {
    draw()
    expect(screen.queryByText(/göstərilir/)).toBeNull()
  })
})

describe('ShareCard — the memo boundary', () => {
  // Mirrors ChatPage: `meta` is a stable store reference (msg.meta) and `onOpen`
  // is a stable useCopilotAction callback. Both are hoisted here for the same
  // reason they're stable there — a fresh object or lambda per render would kill
  // the memo, and with it this guarantee.
  const STABLE_META = meta()
  const STABLE_ON_OPEN = vi.fn()

  function Harness() {
    const [draft, setDraft] = useState('')
    return (
      <>
        <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <ShareCard meta={STABLE_META} canOpen={false} onOpen={STABLE_ON_OPEN} />
      </>
    )
  }

  it('a composer keystroke neither re-renders the card nor disturbs an open dialog', async () => {
    // ChatPage holds `draft` state and re-renders on every character typed. If the
    // dialog state is ever hoisted out of ShareCard, each card gets a fresh
    // callback prop per keystroke, memo dies, and the whole thread — plus the open
    // dialog and its recharts tree — re-renders on every letter. This is the guard.
    render(<Harness />)
    await userEvent.click(expandBtn())
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // A dead probe would make the assertion below pass vacuously (0 === 0).
    const before = preview.renders
    expect(before).toBeGreaterThan(0)

    await userEvent.type(screen.getByLabelText('draft'), 'salam')
    expect(screen.getByLabelText('draft')).toHaveValue('salam')

    // Five characters typed, zero re-renders reached the card.
    expect(preview.renders).toBe(before)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
