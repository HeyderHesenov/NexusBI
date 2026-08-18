import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/requirement', () => ({
  extractRequirements: vi.fn(),
  buildFromRequirement: vi.fn(),
  getRequirement: vi.fn(),
  promoteKpi: vi.fn(),
}))
vi.mock('../api/decision', () => ({ measure: vi.fn() }))

import { useRequirementStore } from './requirementStore'
import * as api from '../api/requirement'
import * as decisionApi from '../api/decision'

const promoteKpi = vi.mocked(api.promoteKpi)
const getRequirement = vi.mocked(api.getRequirement)
const measure = vi.mocked(decisionApi.measure)

const kpi = (question: string, over: Record<string, unknown> = {}) => ({
  name: question, question, rationale: '', requirement_ref: '',
  target_value: null, direction: null, decision_id: null, outcome: null, ...over,
})

const doc = (over: Record<string, unknown> = {}) =>
  ({
    id: 'doc-1', name: 'BRD', dashboard_id: null, created_at: '2026-01-01T00:00:00Z',
    kpis: [kpi('Aylıq gəlir nədir?'), kpi('Çıxma faizi nədir?')], ...over,
  }) as never

const body = (index: number) => ({
  kpi_index: index, target_value: 20, direction: null, datasource_id: null,
})

/** A promise the test resolves by hand, so a call can be held IN FLIGHT. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  useRequirementStore.setState({ doc: doc(), promoting: null, measuring: null })
})

describe('requirementStore.promote', () => {
  it('tracks a second KPI while the first is still in flight', async () => {
    // The lock is PER KPI, matching what the page greys out: `promoting` is
    // compared against `${doc.id}:${index}` for each row, so only that one
    // button is disabled. A global in-flight flag would drop this second click
    // with no toast and no disabled state — a button that silently does nothing.
    const first = deferred<never>()
    promoteKpi.mockImplementationOnce(() => first.promise)
    promoteKpi.mockResolvedValue({ decision: {}, requirement: doc() } as never)

    const s = useRequirementStore.getState()
    const inFlight = s.promote(body(0))
    const second = s.promote(body(1))

    expect(promoteKpi).toHaveBeenCalledTimes(2)
    expect(promoteKpi.mock.calls.map((c) => c[1].kpi_index)).toEqual([0, 1])

    first.resolve({ decision: {}, requirement: doc() } as never)
    await Promise.all([inFlight, second])
  })

  it('drops a double click on the SAME KPI', async () => {
    const held = deferred<never>()
    promoteKpi.mockImplementation(() => held.promise)

    const s = useRequirementStore.getState()
    const inFlight = s.promote(body(0))
    await s.promote(body(0))

    expect(promoteKpi).toHaveBeenCalledTimes(1)
    held.resolve({ decision: {}, requirement: doc() } as never)
    await inFlight
  })

  it('swaps in the server document, which carries the verdict', async () => {
    // Not a locally patched copy: only the server's document has the decision
    // link AND the joined outcome, and the page renders the criterion row from
    // exactly that field.
    const answered = doc({
      kpis: [
        kpi('Aylıq gəlir nədir?', {
          decision_id: 'dec-1',
          outcome: { decision_id: 'dec-1', impact_status: 'on_track', predicted_value: 20 },
        }),
        kpi('Çıxma faizi nədir?'),
      ],
    })
    promoteKpi.mockResolvedValue({ decision: { id: 'dec-1' }, requirement: answered } as never)

    await useRequirementStore.getState().promote(body(0))

    const stored = useRequirementStore.getState().doc
    expect(stored?.kpis[0].outcome?.impact_status).toBe('on_track')
    expect(useRequirementStore.getState().promoting).toBeNull()
  })

  it('releases the lock when the request fails', async () => {
    promoteKpi.mockRejectedValue(new Error('500'))
    await useRequirementStore.getState().promote(body(0))
    expect(useRequirementStore.getState().promoting).toBeNull()

    promoteKpi.mockResolvedValue({ decision: {}, requirement: doc() } as never)
    await useRequirementStore.getState().promote(body(0))
    expect(promoteKpi).toHaveBeenCalledTimes(2)
  })
})

describe('requirementStore.measureKpi', () => {
  it('measures a second decision while the first is still in flight', async () => {
    const first = deferred<never>()
    measure.mockImplementationOnce(() => first.promise)
    measure.mockResolvedValue({} as never)
    getRequirement.mockResolvedValue(doc())

    const s = useRequirementStore.getState()
    const inFlight = s.measureKpi('dec-1')
    const second = s.measureKpi('dec-2')

    expect(measure).toHaveBeenCalledTimes(2)
    first.resolve({} as never)
    await Promise.all([inFlight, second])
  })

  it('re-reads the document instead of patching it locally', async () => {
    // The measure response is a DecisionROI: it carries the values but no
    // data_as_of, so patching from it would drop the freshness signal on the one
    // path where the number just changed.
    measure.mockResolvedValue({} as never)
    getRequirement.mockResolvedValue(doc({ name: 'server copy' }))

    await useRequirementStore.getState().measureKpi('dec-1')

    expect(getRequirement).toHaveBeenCalledWith('doc-1')
    expect(useRequirementStore.getState().doc?.name).toBe('server copy')
    expect(useRequirementStore.getState().measuring).toBeNull()
  })
})
