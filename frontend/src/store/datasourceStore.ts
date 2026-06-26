import { create } from 'zustand'
import toast from 'react-hot-toast'
import type { DataSource, DataSourceCreate, DataSourceSchema } from '../types'
import * as dsApi from '../api/datasource'
import { useQueryStore } from './queryStore'

interface DatasourceState {
  sources: DataSource[]
  schemas: Record<string, DataSourceSchema>
  loading: boolean
  load: () => Promise<void>
  loadSchema: (id: string) => Promise<DataSourceSchema>
  create: (payload: DataSourceCreate) => Promise<DataSource>
  uploadFile: (file: File, name: string) => Promise<DataSource>
  connectPowerBI: (name: string, datasetId: string) => Promise<DataSource>
  test: (id: string) => Promise<boolean>
  remove: (id: string) => Promise<void>
}

export const useDatasourceStore = create<DatasourceState>((set, get) => ({
  sources: [],
  schemas: {},
  loading: false,
  loadSchema: async (id) => {
    const cached = get().schemas[id]
    if (cached) return cached
    const schema = await dsApi.getSchema(id)
    set({ schemas: { ...get().schemas, [id]: schema } })
    return schema
  },
  load: async () => {
    set({ loading: true })
    try {
      set({ sources: await dsApi.list() })
    } finally {
      set({ loading: false })
    }
  },
  create: async (payload) => {
    const ds = await dsApi.create(payload)
    set({ sources: [...get().sources, ds] })
    useQueryStore.getState().setDatasource(ds.id)
    toast.success('Mənbə qoşuldu.')
    return ds
  },
  uploadFile: async (file, name) => {
    const ds = await dsApi.upload(file, name)
    set({ sources: [...get().sources, ds] })
    useQueryStore.getState().setDatasource(ds.id)
    toast.success('Fayl yükləndi.')
    return ds
  },
  connectPowerBI: async (name, datasetId) => {
    const ds = await dsApi.connectPowerBI(name, datasetId)
    set({ sources: [...get().sources, ds] })
    useQueryStore.getState().setDatasource(ds.id)
    toast.success('Power BI qoşuldu.')
    return ds
  },
  test: async (id) => {
    try {
      const ok = await dsApi.test(id)
      toast[ok ? 'success' : 'error'](ok ? 'Bağlantı uğurlu.' : 'Bağlantı uğursuz.')
      return ok
    } catch {
      return false // interceptor already toasted
    }
  },
  remove: async (id) => {
    await dsApi.remove(id)
    set({ sources: get().sources.filter((s) => s.id !== id) })
    if (useQueryStore.getState().datasourceId === id) {
      useQueryStore.getState().setDatasource(null)
    }
  },
}))
