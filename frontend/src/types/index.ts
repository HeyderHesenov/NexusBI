export interface ColumnInfo {
  name: string
  type: string
}

export type ChartType =
  | 'bar'
  | 'line'
  | 'pie'
  | 'scatter'
  | 'table'
  | 'kpi_card'

export interface ChartConfig {
  chart_type: ChartType
  x_axis: string | null
  y_axis: string | null
  color_by: string | null
  reasoning?: string
}

export interface QueryResult {
  sql: string
  data: Record<string, unknown>[]
  columns: ColumnInfo[]
  chart_config: ChartConfig
  insight: string
  execution_time_ms: number
  query_log_id: string | null
}

export interface QueryHistoryItem {
  id: string
  natural_language: string
  generated_sql: string
  chart_type: string
  execution_time_ms: number
  created_at: string
}

export interface QueryHistoryPage {
  items: QueryHistoryItem[]
  page: number
  limit: number
  total: number
}

export interface DataSource {
  id: string
  name: string
  db_type: string
  created_at: string
}

export interface Widget {
  id: string
  title: string
  query_log_id: string | null
  position_x: number
  position_y: number
  width: number
  height: number
}

export interface Dashboard {
  id: string
  name: string
  description: string
  layout: Record<string, unknown> | null
  widgets: Widget[]
}

export interface DashboardSummary {
  id: string
  name: string
  description: string
}

export interface AuthUser {
  id: string
  email: string
  full_name: string
  is_active: boolean
}

export interface AuthProviders {
  google_enabled: boolean
  google_client_id: string | null
}
