import { beforeEach, describe, expect, it } from 'vitest'
import { useTwinStore } from './twinStore'

beforeEach(() => {
  useTwinStore.setState({ adjustments: {}, scenarios: [] })
  localStorage.removeItem('nexusbi-twin')
})

describe('twinStore', () => {
  it('setAdjustment stores non-zero and removes zero values', () => {
    useTwinStore.getState().setAdjustment('a', 15)
    expect(useTwinStore.getState().adjustments).toEqual({ a: 15 })
    useTwinStore.getState().setAdjustment('a', 0)
    expect(useTwinStore.getState().adjustments).toEqual({})
  })

  it('save/load/delete scenario round-trip', () => {
    useTwinStore.getState().setAdjustment('a', 20)
    useTwinStore.getState().saveScenario('Aqressiv plan', 'root1', new Set(['a']))
    useTwinStore.getState().clearAdjustments()
    expect(useTwinStore.getState().adjustments).toEqual({})

    const sc = useTwinStore.getState().scenarios[0]
    expect(sc.name).toBe('Aqressiv plan')
    expect(sc.rootId).toBe('root1')
    useTwinStore.getState().loadScenario(sc.id, new Set(['a']))
    expect(useTwinStore.getState().adjustments).toEqual({ a: 20 })

    useTwinStore.getState().deleteScenario(sc.id)
    expect(useTwinStore.getState().scenarios).toEqual([])
  })

  it('pruneToLeaves drops adjustments for deleted nodes', () => {
    useTwinStore.getState().setAdjustment('alive', 10)
    useTwinStore.getState().setAdjustment('dead', 30)
    useTwinStore.getState().pruneToLeaves(new Set(['alive']))
    expect(useTwinStore.getState().adjustments).toEqual({ alive: 10 })
  })

  it('persists ONLY scenarios to localStorage (adjustments are transient)', () => {
    useTwinStore.getState().setAdjustment('a', 25)
    useTwinStore.getState().saveScenario('Plan', 'root1', new Set(['a']))
    const state = JSON.parse(localStorage.getItem('nexusbi-twin')!).state
    expect(state.scenarios).toHaveLength(1)
    expect(state.scenarios[0].adjustments).toEqual({ a: 25 })
    expect(state.adjustments).toBeUndefined()
  })

  it('clearAdjustments scoped to leaf ids leaves other roots untouched', () => {
    useTwinStore.getState().setAdjustment('rootA-leaf', 10)
    useTwinStore.getState().setAdjustment('rootB-leaf', 20)
    useTwinStore.getState().clearAdjustments(new Set(['rootA-leaf']))
    expect(useTwinStore.getState().adjustments).toEqual({ 'rootB-leaf': 20 })
  })

  it('pruneScenarios drops scenarios whose root no longer exists', () => {
    useTwinStore.getState().setAdjustment('a', 5)
    useTwinStore.getState().saveScenario('Köhnə', 'gone-root', new Set(['a']))
    useTwinStore.getState().saveScenario('Sağ', 'alive-root', new Set(['a']))
    useTwinStore.getState().pruneScenarios(new Set(['alive-root']))
    expect(useTwinStore.getState().scenarios.map((s) => s.name)).toEqual(['Sağ'])
  })
})
