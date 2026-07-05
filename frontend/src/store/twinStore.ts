import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Adjustments } from '../lib/metricTreeMath'
import type { LeverRanges } from '../lib/twinAnalysis'

export interface TwinScenario {
  id: string
  name: string
  rootId: string
  adjustments: Adjustments
}

interface TwinState {
  adjustments: Adjustments
  scenarios: TwinScenario[]
  /** Monte Carlo per-leaf sampling ranges (transient, like adjustments). */
  ranges: LeverRanges
  setAdjustment: (leafId: string, pct: number) => void
  /** Set a leaf's Monte Carlo min/max range. */
  setRange: (leafId: string, range: { min: number; max: number }) => void
  /** Clear only the given leaves' ranges; no arg = all. */
  clearRanges: (leafIds?: Set<string>) => void
  /** Clear only the given leaves' adjustments (other roots' work survives); no arg = all. */
  clearAdjustments: (leafIds?: Set<string>) => void
  /** Snapshot ONLY the given root's leaf adjustments (cross-root state must not leak). */
  saveScenario: (name: string, rootId: string, leafIds: Set<string>) => void
  /** Replace the given root's leaf adjustments with the scenario's; leave other roots untouched. */
  loadScenario: (id: string, leafIds: Set<string>) => void
  deleteScenario: (id: string) => void
  /** Drop adjustments whose node no longer exists in the fetched forest. */
  pruneToLeaves: (leafIds: Set<string>) => void
  /** Drop scenarios whose root no longer exists (they'd be unreachable chips). */
  pruneScenarios: (rootIds: Set<string>) => void
}

let counter = 0
const scenarioId = () => `tw-${Date.now().toString(36)}-${counter++}`

export const useTwinStore = create<TwinState>()(
  persist(
    (set, get) => ({
      adjustments: {},
      scenarios: [],
      ranges: {},
      setAdjustment: (leafId, pct) =>
        set((s) => {
          const next = { ...s.adjustments }
          if (pct === 0) delete next[leafId]
          else next[leafId] = pct
          return { adjustments: next }
        }),
      setRange: (leafId, range) =>
        set((s) => {
          const next = { ...s.ranges }
          if (range.min === 0 && range.max === 0) delete next[leafId]
          else next[leafId] = range
          return { ranges: next }
        }),
      clearRanges: (leafIds) =>
        set((s) => ({
          ranges: leafIds
            ? Object.fromEntries(Object.entries(s.ranges).filter(([id]) => !leafIds.has(id)))
            : {},
        })),
      clearAdjustments: (leafIds) =>
        set((s) => ({
          adjustments: leafIds
            ? Object.fromEntries(
                Object.entries(s.adjustments).filter(([id]) => !leafIds.has(id)),
              )
            : {},
        })),
      saveScenario: (name, rootId, leafIds) => {
        const { adjustments, scenarios } = get()
        const scoped = Object.fromEntries(
          Object.entries(adjustments).filter(([id]) => leafIds.has(id)),
        )
        set({
          scenarios: [
            ...scenarios,
            { id: scenarioId(), name: name.trim().slice(0, 80), rootId, adjustments: scoped },
          ],
        })
      },
      loadScenario: (id, leafIds) => {
        const sc = get().scenarios.find((s) => s.id === id)
        if (!sc) return
        set((s) => ({
          adjustments: {
            ...Object.fromEntries(
              Object.entries(s.adjustments).filter(([aid]) => !leafIds.has(aid)),
            ),
            ...sc.adjustments,
          },
        }))
      },
      deleteScenario: (id) =>
        set((s) => ({ scenarios: s.scenarios.filter((sc) => sc.id !== id) })),
      pruneToLeaves: (leafIds) =>
        set((s) => ({
          adjustments: Object.fromEntries(
            Object.entries(s.adjustments).filter(([id]) => leafIds.has(id)),
          ),
        })),
      pruneScenarios: (rootIds) =>
        set((s) => ({ scenarios: s.scenarios.filter((sc) => rootIds.has(sc.rootId)) })),
    }),
    {
      name: 'nexusbi-twin',
      // Only scenarios are durable. Live slider state is transient — persisting
      // it would JSON.stringify the whole store to localStorage on every drag tick.
      partialize: (s) => ({ scenarios: s.scenarios }),
    },
  ),
)
