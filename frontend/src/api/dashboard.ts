import { client } from './client'
import type {
  Dashboard,
  DashboardFilterSpec,
  DashboardSummary,
  DataStory,
  Widget,
  WidgetChart,
} from '../types'
import type { Comment } from '../store/collabStore'

export interface FilteredWidget {
  widget_id: string
  chart: WidgetChart | null
}

export interface DashboardFilterResult {
  global_filter: DashboardFilterSpec | null
  widgets: FilteredWidget[]
}

export async function listDashboards(): Promise<DashboardSummary[]> {
  const { data } = await client.get<DashboardSummary[]>('/dashboard/')
  return data
}

export async function createDashboard(
  name: string,
  description = '',
): Promise<Dashboard> {
  const { data } = await client.post<Dashboard>('/dashboard/', { name, description })
  return data
}

export async function generateDashboard(
  goal: string,
  datasourceId: string | null,
): Promise<Dashboard> {
  const { data } = await client.post<Dashboard>('/dashboard/generate', {
    goal,
    datasource_id: datasourceId,
  })
  return data
}

export async function getDashboard(id: string): Promise<Dashboard> {
  const { data } = await client.get<Dashboard>(`/dashboard/${id}`)
  return data
}

export async function getWsTicket(id: string): Promise<string> {
  const { data } = await client.get<{ ticket: string }>(`/dashboard/${id}/ws-ticket`)
  return data.ticket
}

export async function updateDashboard(
  id: string,
  payload: Partial<Pick<Dashboard, 'name' | 'description' | 'layout'>>,
): Promise<Dashboard> {
  const { data } = await client.put<Dashboard>(`/dashboard/${id}`, payload)
  return data
}

export async function deleteDashboard(id: string): Promise<void> {
  await client.delete(`/dashboard/${id}`)
}

export async function addWidget(
  dashboardId: string,
  payload: { query_log_id: string; title: string },
): Promise<Widget> {
  const { data } = await client.post<Widget>(`/dashboard/${dashboardId}/widget`, payload)
  return data
}

export async function removeWidget(
  dashboardId: string,
  widgetId: string,
): Promise<void> {
  await client.delete(`/dashboard/${dashboardId}/widget/${widgetId}`)
}

export async function refreshWidget(
  dashboardId: string,
  widgetId: string,
): Promise<Widget> {
  const { data } = await client.post<Widget>(
    `/dashboard/${dashboardId}/widget/${widgetId}/refresh`,
  )
  return data
}

export async function refreshAll(dashboardId: string): Promise<Dashboard> {
  const { data } = await client.post<Dashboard>(`/dashboard/${dashboardId}/refresh-all`)
  return data
}

export async function buildStory(dashboardId: string): Promise<DataStory> {
  const { data } = await client.post<DataStory>(`/dashboard/${dashboardId}/story`)
  return data
}

export async function enableShare(dashboardId: string): Promise<string> {
  const { data } = await client.post<{ token: string }>(`/dashboard/${dashboardId}/share`)
  return data.token
}

export async function disableShare(dashboardId: string): Promise<void> {
  await client.delete(`/dashboard/${dashboardId}/share`)
}

export async function setEmbed(
  dashboardId: string,
  enabled: boolean,
): Promise<{ embed_enabled: boolean; token: string | null }> {
  const { data } = await client.patch<{ embed_enabled: boolean; token: string | null }>(
    `/dashboard/${dashboardId}/embed`,
    { enabled },
  )
  return data
}

export async function setLive(
  dashboardId: string,
  enabled: boolean,
  intervalSeconds?: number,
): Promise<Dashboard> {
  const { data } = await client.patch<Dashboard>(`/dashboard/${dashboardId}/live`, {
    enabled,
    interval_seconds: intervalSeconds,
  })
  return data
}

export async function applyFilter(
  dashboardId: string,
  spec: DashboardFilterSpec,
): Promise<DashboardFilterResult> {
  const { data } = await client.patch<DashboardFilterResult>(
    `/dashboard/${dashboardId}/filter`,
    spec,
  )
  return data
}

export async function getPublicDashboard(token: string): Promise<Dashboard> {
  const { data } = await client.get<Dashboard>(`/public/dashboard/${token}`)
  return data
}

/** Viewer-side filter on a shared/embedded dashboard — read-only, never persisted. */
export async function applyPublicFilter(
  token: string,
  spec: DashboardFilterSpec,
  kind: 'public' | 'embed' = 'public',
): Promise<DashboardFilterResult> {
  const path =
    kind === 'embed' ? `/public/embed/${token}/filter` : `/public/dashboard/${token}/filter`
  const { data } = await client.post<DashboardFilterResult>(path, spec)
  return data
}

export async function getComments(dashboardId: string): Promise<Comment[]> {
  const { data } = await client.get<Comment[]>(`/dashboard/${dashboardId}/comments`)
  return data
}

export async function getPublicComments(token: string): Promise<Comment[]> {
  const { data } = await client.get<Comment[]>(`/public/dashboard/${token}/comments`)
  return data
}
