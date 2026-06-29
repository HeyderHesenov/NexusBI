import { beforeEach, describe, expect, it } from 'vitest'
import { useDashboardStore } from './dashboardStore'

// applyLiveUpdate is a pure reducer (no API). We drive it via setState/getState.
const chart = (n: number) => ({ chart_type: 'bar', data: [{ x: n }], chart_config: {} }) as never

function seed() {
  useDashboardStore.setState({
    current: {
      id: 'd1',
      widgets: [
        { id: 'w1', chart: chart(1) },
        { id: 'w2', chart: chart(2) },
      ],
    } as never,
    pulses: {},
  })
}

describe('dashboardStore.applyLiveUpdate', () => {
  beforeEach(seed)

  it('ignores updates for a different dashboard', () => {
    useDashboardStore.getState().applyLiveUpdate('other', [{ widget_id: 'w1', chart: chart(9) }] as never)
    expect(useDashboardStore.getState().pulses).toEqual({})
    expect(useDashboardStore.getState().current?.widgets[0].chart).toEqual(chart(1))
  })

  it('ignores an empty update list', () => {
    useDashboardStore.getState().applyLiveUpdate('d1', [])
    expect(useDashboardStore.getState().pulses).toEqual({})
  })

  it('swaps the matching widget chart and bumps only its pulse', () => {
    useDashboardStore.getState().applyLiveUpdate('d1', [{ widget_id: 'w1', chart: chart(9) }] as never)
    const s = useDashboardStore.getState()
    expect(s.current?.widgets[0].chart).toEqual(chart(9))
    expect(s.current?.widgets[1].chart).toEqual(chart(2)) // untouched
    expect(s.pulses).toEqual({ w1: 1 })
  })

  it('increments the pulse counter on repeated updates', () => {
    const { applyLiveUpdate } = useDashboardStore.getState()
    applyLiveUpdate('d1', [{ widget_id: 'w1', chart: chart(3) }] as never)
    applyLiveUpdate('d1', [{ widget_id: 'w1', chart: chart(4) }] as never)
    expect(useDashboardStore.getState().pulses.w1).toBe(2)
  })
})
