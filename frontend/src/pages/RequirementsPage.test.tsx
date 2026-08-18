import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSource, KpiItem, KpiOutcome, RequirementDoc } from '../types'

const build = vi.fn()
const loadSources = vi.fn()
const promote = vi.fn()
const measureKpi = vi.fn()

let reqState: Record<string, unknown>
let dsState: { sources: DataSource[]; load: typeof loadSources }

vi.mock('../store/requirementStore', () => ({
  useRequirementStore: Object.assign(() => reqState, { getState: () => reqState }),
}))
vi.mock('../store/datasourceStore', () => ({
  useDatasourceStore: Object.assign(() => dsState, { getState: () => dsState }),
}))
vi.mock('../store/dashboardStore', () => ({
  useDashboardStore: Object.assign(
    () => ({ loadList: vi.fn(), open: vi.fn() }),
    { getState: () => ({ loadList: vi.fn(), open: vi.fn() }) },
  ),
}))

import { RequirementsPage } from './RequirementsPage'
import { useLocaleStore } from '../store/localeStore'

const source = (id: string, name: string): DataSource => ({
  id,
  name,
  db_type: 'postgresql',
  created_at: '2024-01-01T00:00:00Z',
})

const kpi = (over: Partial<KpiItem> = {}): KpiItem => ({
  name: 'Gəlir',
  question: 'Aylıq gəlir nədir?',
  rationale: '',
  requirement_ref: 'R1',
  target_value: null,
  direction: null,
  decision_id: null,
  outcome: null,
  ...over,
})

const outcome = (over: Partial<KpiOutcome> = {}): KpiOutcome => ({
  decision_id: 'dec-1',
  impact_status: 'achieved',
  baseline_value: 10,
  predicted_value: 20,
  predicted_direction: 'increase',
  realized_value: 25,
  measured_at: '2026-01-10T12:00:00Z',
  data_as_of: '2026-01-10T12:00:00Z',
  ...over,
})

const docWith = (...kpis: KpiItem[]): RequirementDoc => ({
  id: 'doc-1',
  name: 'BRD',
  kpis,
  dashboard_id: null,
  created_at: '2024-01-01T00:00:00Z',
})

const doc: RequirementDoc = docWith(kpi())

// Test i18n is initialized with Azerbaijani (see src/test/setup.ts).
const SOURCE_LABEL = 'Dashboard və izləmə üçün mənbə'
const BUILD = /Dashboard qur/

const renderPage = () =>
  render(
    <MemoryRouter>
      <RequirementsPage />
    </MemoryRouter>,
  )

describe('RequirementsPage source selection', () => {
  beforeEach(() => {
    build.mockReset().mockResolvedValue(null)
    loadSources.mockReset().mockResolvedValue(undefined)
    promote.mockReset().mockResolvedValue(undefined)
    measureKpi.mockReset().mockResolvedValue(undefined)
    reqState = {
      doc,
      extracting: false,
      building: false,
      promoting: null,
      measuring: null,
      extract: vi.fn(),
      build,
      promote,
      measureKpi,
      reset: vi.fn(),
    }
    dsState = { sources: [source('a', 'Acme Postgres'), source('b', 'Sales CSV')], load: loadSources }
  })

  it('builds against the source you picked', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(SOURCE_LABEL), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: BUILD }))
    expect(build).toHaveBeenCalledWith('a', ['Aylıq gəlir nədir?'])
  })

  it('drops a selection whose source disappeared, instead of building against a dead id', () => {
    // The assertion is on what build() receives, NOT on the select's value: a
    // select holding a value with no matching option reports '' either way, so
    // reading the DOM would pass against the unfixed code too. The dead id is
    // only visible in what the page posts.
    const { rerender } = renderPage()
    fireEvent.change(screen.getByLabelText(SOURCE_LABEL), { target: { value: 'a' } })

    // datasourceStore.remove() filters the list and clears queryStore's
    // selection — it cannot reach this page's local state.
    dsState = { sources: [source('b', 'Sales CSV')], load: loadSources }
    rerender(
      <MemoryRouter>
        <RequirementsPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: BUILD }))
    expect(build).toHaveBeenCalledWith(null, ['Aylıq gəlir nədir?'])
  })

  it('keeps a selection that still exists when the list refreshes', () => {
    const { rerender } = renderPage()
    fireEvent.change(screen.getByLabelText(SOURCE_LABEL), { target: { value: 'a' } })

    // A new arrival must not disturb an existing, still-valid choice.
    dsState = {
      sources: [source('a', 'Acme Postgres'), source('b', 'Sales CSV'), source('c', 'New')],
      load: loadSources,
    }
    rerender(
      <MemoryRouter>
        <RequirementsPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: BUILD }))
    expect(build).toHaveBeenCalledWith('a', ['Aylıq gəlir nədir?'])
  })
})

describe('RequirementsPage acceptance criterion', () => {
  const TARGET = 'Qəbul meyarı'
  const DIRECTION = 'İstiqamət'
  const TRACK = 'İzlə'

  const setup = (...kpis: KpiItem[]) => {
    promote.mockReset().mockResolvedValue(undefined)
    measureKpi.mockReset().mockResolvedValue(undefined)
    loadSources.mockReset().mockResolvedValue(undefined)
    reqState = {
      doc: docWith(...kpis),
      extracting: false,
      building: false,
      promoting: null,
      measuring: null,
      extract: vi.fn(),
      build,
      promote,
      measureKpi,
      reset: vi.fn(),
    }
    dsState = { sources: [source('a', 'Acme Postgres')], load: loadSources }
    return renderPage()
  }

  it("pre-fills the criterion the extraction proposed", () => {
    setup(kpi({ target_value: 15, direction: 'decrease' }))
    expect(screen.getByLabelText(TARGET)).toHaveValue(15)
    expect(screen.getByLabelText(DIRECTION)).toHaveValue('decrease')
  })

  it('sends the target as a number, not as the raw input string', () => {
    setup(kpi())
    fireEvent.change(screen.getByLabelText(TARGET), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(DIRECTION), { target: { value: 'decrease' } })
    fireEvent.click(screen.getByRole('button', { name: TRACK }))
    // Pydantic would coerce a string, so only this assertion notices.
    expect(promote).toHaveBeenCalledWith({
      kpi_index: 0,
      target_value: 20,
      direction: 'decrease',
      datasource_id: null,
    })
  })

  it('will not track a KPI with no number, because there is nothing to test', () => {
    setup(kpi())
    expect(screen.getByRole('button', { name: TRACK })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(TARGET), { target: { value: '5' } })
    expect(screen.getByRole('button', { name: TRACK })).toBeEnabled()
  })

  it('does not deselect the KPI when you type its target', () => {
    // The whole row lives inside the <li>'s selection onClick, so without
    // stopPropagation every interaction with the form toggles the KPI off.
    setup(kpi())
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(screen.getByLabelText(TARGET))
    expect(box.checked).toBe(true)
  })

  it('reports a stale verdict with the age of the number behind it', () => {
    setup(kpi({ decision_id: 'dec-1', outcome: outcome({ data_as_of: '2026-01-10T09:00:00Z' }) }))
    expect(screen.getByText('Nail olundu')).toBeInTheDocument()
    expect(screen.getByText(/data:/)).toBeInTheDocument()
  })

  it('says nothing about age when the number is as fresh as the reading', () => {
    setup(kpi({ decision_id: 'dec-1', outcome: outcome({ data_as_of: '2026-01-10T11:59:30Z' }) }))
    expect(screen.getByText('Nail olundu')).toBeInTheDocument()
    expect(screen.queryByText(/data:/)).not.toBeInTheDocument()
  })

  it('distinguishes a baseline that failed from one still awaiting a measure', () => {
    setup(kpi({ decision_id: 'dec-1', outcome: outcome({ impact_status: 'pending', baseline_value: null }) }))
    expect(screen.getByText(/Başlanğıc ölçü alınmadı/)).toBeInTheDocument()
    expect(screen.queryByText(/Hədəf/)).not.toBeInTheDocument()
  })

  it('measures through the store, which re-reads the document afterwards', () => {
    setup(kpi({ decision_id: 'dec-1', outcome: outcome() }))
    fireEvent.click(screen.getByRole('button', { name: 'Ölç' }))
    expect(measureKpi).toHaveBeenCalledWith('dec-1')
  })
})

describe('RequirementsPage criterion regressions', () => {
  const TARGET = 'Qəbul meyarı'

  const setupDoc = (docId: string, ...kpis: KpiItem[]) => {
    promote.mockReset().mockResolvedValue(undefined)
    measureKpi.mockReset().mockResolvedValue(undefined)
    loadSources.mockReset().mockResolvedValue(undefined)
    reqState = {
      doc: { ...docWith(...kpis), id: docId },
      extracting: false,
      building: false,
      promoting: null,
      measuring: null,
      extract: vi.fn(),
      build,
      promote,
      measureKpi,
      reset: vi.fn(),
    }
    dsState = { sources: [], load: loadSources }
    return renderPage()
  }

  // act(): the store has live subscribers until RTL's own cleanup runs, and
  // this hook is registered later, so it fires first.
  afterEach(() => act(() => useLocaleStore.setState({ lang: 'az' })))

  it('shows an unknown target as unknown, not as a demand for zero', () => {
    // A null prediction rendered as "Hədəf 0" tells the user the requirement
    // demanded zero — a criterion nobody wrote.
    setupDoc('doc-1', kpi({ decision_id: 'dec-1', outcome: outcome({ predicted_value: null }) }))
    expect(screen.getByText(/Hədəf — /)).toBeInTheDocument()
    expect(screen.queryByText(/Hədəf 0 /)).not.toBeInTheDocument()
  })

  it('does not carry a typed target into a freshly extracted document', () => {
    // CriterionRow seeds target/direction with useState, which runs at MOUNT
    // only. Keyed by index alone, a second extraction reuses the same instances,
    // so a threshold typed for the previous requirement stays in the box — and
    // İzlə would promote it against a KPI nobody wrote it for.
    const { rerender } = setupDoc('doc-1', kpi())
    fireEvent.change(screen.getByLabelText(TARGET), { target: { value: '42' } })
    expect(screen.getByLabelText(TARGET)).toHaveValue(42)

    reqState.doc = { ...docWith(kpi()), id: 'doc-2' }
    rerender(
      <MemoryRouter>
        <RequirementsPage />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(TARGET)).toHaveValue(null)
  })

  it('dates the number in the language the user picked, not in a hardcoded one', () => {
    // formatDate's locale DEFAULTS to 'az-AZ', so calling it directly renders an
    // Azerbaijani date to a Russian or English user. The two renders below are
    // the assertion: same instant, different language, and the strings must
    // differ — comparing one against a literal would also pass on the frozen
    // default, since that default IS az.
    const stale = () =>
      setupDoc('doc-1', kpi({ decision_id: 'dec-1', outcome: outcome({ data_as_of: '2026-01-10T09:00:00Z' }) }))

    const view = stale()
    const az = screen.getByText(/data:/).textContent ?? ''
    view.unmount()

    act(() => useLocaleStore.setState({ lang: 'en' }))
    stale()
    const en = screen.getByText(/data:/).textContent ?? ''

    expect(az).toMatch(/10\.01\.26/) // az-AZ: day-first, dotted
    expect(en).toMatch(/1\/10\/26/) // en-US: month-first, slashed
    expect(en).not.toBe(az)
  })
})
