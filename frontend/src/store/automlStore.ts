import { create } from 'zustand'
import type { AutoMLTable, MLModelInfo, MLPredictionExplain } from '../types'
import * as api from '../api/automl'

interface AutoMLState {
  tables: AutoMLTable[]
  models: MLModelInfo[]
  sourceTable: string | null
  targetColumn: string | null
  training: boolean
  /** The model shown in the result/predict panel. */
  current: MLModelInfo | null
  predictions: unknown[] | null
  /** Per-prediction explanations, parallel to `predictions`. */
  explanations: MLPredictionExplain[][]
  load: () => Promise<void>
  pickSource: (table: string) => void
  pickTarget: (column: string) => void
  train: (name: string) => Promise<void>
  select: (id: string) => void
  predict: (rows: Record<string, unknown>[]) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useAutoMLStore = create<AutoMLState>((set, get) => ({
  tables: [],
  models: [],
  sourceTable: null,
  targetColumn: null,
  training: false,
  current: null,
  predictions: null,
  explanations: [],
  load: async () => {
    const [tables, models] = await Promise.all([api.tables(), api.listModels()])
    set({ tables, models })
  },
  pickSource: (table) =>
    set({ sourceTable: table, targetColumn: null, predictions: null, explanations: [] }),
  pickTarget: (column) => set({ targetColumn: column }),
  train: async (name) => {
    const { sourceTable, targetColumn } = get()
    if (!sourceTable || !targetColumn) return
    set({ training: true })
    try {
      const model = await api.train({
        name,
        source_table: sourceTable,
        target_column: targetColumn,
      })
      set({
        models: [model, ...get().models],
        current: model,
        predictions: null,
        explanations: [],
      })
    } finally {
      set({ training: false })
    }
  },
  select: (id) => {
    const found = get().models.find((m) => m.id === id)
    if (found) set({ current: found, predictions: null, explanations: [] })
  },
  predict: async (rows) => {
    const { current } = get()
    if (!current) return
    const { predictions, explanations } = await api.predict(current.id, rows)
    set({ predictions, explanations })
  },
  remove: async (id) => {
    await api.removeModel(id)
    set({
      models: get().models.filter((m) => m.id !== id),
      ...(get().current?.id === id
        ? { current: null, predictions: null, explanations: [] }
        : {}),
    })
  },
}))
