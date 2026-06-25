export interface ColumnInfo {
  name: string
  type: string
}

export type ChartType =
  | 'bar'
  | 'line'
  | 'area'
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
  from_cache?: boolean
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

export interface DataSourceCreate {
  name: string
  db_type: 'postgresql' | 'sqlite'
  connection_string: string
}

/** { tableName: [{ name, type }, ...] } */
export type DataSourceSchema = Record<string, { name: string; type: string }[]>

export type Schedule = 'off' | 'hourly' | 'daily' | 'weekly'

export interface SavedQuery {
  id: string
  name: string
  nl_query: string
  datasource_id: string | null
  schedule: Schedule
  last_run_at: string | null
  last_query_log_id: string | null
  created_at: string
}

export interface SavedQueryCreate {
  name: string
  nl_query: string
  datasource_id: string | null
  schedule: Schedule
}

export interface WidgetChart {
  chart_type: ChartType
  chart_config: ChartConfig
  columns: string[]
  data: Record<string, unknown>[]
  insight: string
  sql: string
  natural_language: string
  datasource_id?: string | null
  datasource_name?: string
}

export interface Widget {
  id: string
  title: string
  query_log_id: string | null
  position_x: number
  position_y: number
  width: number
  height: number
  chart: WidgetChart | null
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
  subscription_tier: string
}

export interface Plan {
  key: string
  name: string
  price_usd: number
  monthly_quota: number
  features: string[]
}

export interface Usage {
  tier: string
  tier_name: string
  used: number
  limit: number
  remaining: number
  period_start: string | null
  resets_at: string | null
}

export interface AuthProviders {
  google_enabled: boolean
  google_client_id: string | null
}

export interface AnomalyPoint {
  label: string | null
  value: number | null
  severity: 'low' | 'medium' | 'high'
  explanation: string
}

export interface AnomalyResult {
  anomalies: AnomalyPoint[]
  summary: string
  label_col: string
  value_col: string
}

export interface ForecastPoint {
  label: string
  value: number | null
  lower: number | null
  upper: number | null
}

export interface ForecastResult {
  forecast: ForecastPoint[]
  narrative: string
  label_col: string
  value_col: string
  history: Record<string, unknown>[]
}
