import { client } from './client'

export interface BrandConfig {
  app_name: string
  primary_color: string
  logo_url: string
}

export async function getBrand(): Promise<BrandConfig> {
  const { data } = await client.get<BrandConfig>('/brand')
  return data
}

export async function putBrand(payload: Partial<BrandConfig>): Promise<BrandConfig> {
  const { data } = await client.put<BrandConfig>('/brand', payload)
  return data
}

export interface EmbeddedDashboardView {
  dashboard: import('../types').Dashboard
  brand: BrandConfig
}

/** Public embed fetch — plain fetch (no auth interceptor / redirect on 401). */
export async function getEmbedView(token: string): Promise<EmbeddedDashboardView> {
  const base = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'
  const resp = await fetch(`${base}/public/embed/${token}`)
  if (!resp.ok) throw new Error(String(resp.status))
  return resp.json()
}
