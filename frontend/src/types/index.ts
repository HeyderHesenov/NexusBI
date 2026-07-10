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
  | 'pivot'

export interface ChartConfig {
  chart_type: ChartType
  x_axis: string | null
  y_axis: string | null
  color_by: string | null
  reasoning?: string
  /** Per-chart number-format hint, inferred deterministically by the backend
   *  (ai/chart_format). Optional — configs saved before it existed lack it. */
  format?: { unit?: string | null; currency?: string | null; decimals?: number | null }
  /** Humanized axis titles (backend-filled, optional on older configs). */
  x_label?: string | null
  y_label?: string | null
}

export interface StatFact {
  kind: 'total' | 'top' | 'trend' | 'anomaly'
  label: string
  value: string
}

export interface QueryResult {
  sql: string
  query_language?: 'sql' | 'dax'
  data: Record<string, unknown>[]
  columns: ColumnInfo[]
  chart_config: ChartConfig
  insight: string
  stats_facts?: StatFact[]
  execution_time_ms: number
  query_log_id: string | null
  from_cache?: boolean
}

export interface PowerBIDataset {
  id: string
  name: string
  workspace?: string
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
  freshness_sla_hours?: number | null
  last_refreshed_at?: string | null
  created_at: string
}

export interface DataSourceCreate {
  name: string
  db_type: 'postgresql' | 'mysql' | 'sqlite'
  connection_string: string
}

/** { tableName: [{ name, type }, ...] } */
export type DataSourceSchema = Record<string, { name: string; type: string }[]>

export interface Metric {
  id: string
  name: string
  expression: string
  description: string
  synonyms: string
  datasource_id: string | null
  verified: boolean
  verified_by: string | null
  verified_at: string | null
  created_at: string
}

export interface Lineage {
  tables: string[]
  columns: string[]
  metrics: string[]
}

export interface MetricCreate {
  name: string
  expression: string
  description: string
  synonyms: string
  datasource_id: string | null
}

export type AlertOperator = '>' | '<' | '>=' | '<=' | '==' | '!='
export type AlertConditionType = 'static' | 'anomaly'

export interface Alert {
  id: string
  saved_query_id: string
  name: string
  column: string
  condition_type: AlertConditionType
  operator: string
  threshold: number
  active: boolean
  last_triggered_at: string | null
  created_at: string
}

export interface AlertCreate {
  saved_query_id: string
  name: string
  column: string
  condition_type: AlertConditionType
  operator: AlertOperator
  threshold: number
}

export type NotificationCategory =
  | 'digest'
  | 'kpi_alert'
  | 'ai_quality'
  | 'insight'
  | 'decision'
  | 'mention'

export interface AppNotification {
  id: string
  title: string
  body: string
  read: boolean
  category: NotificationCategory
  alert_id: string | null
  created_at: string
}

export type DecisionStatus = 'open' | 'in_progress' | 'done'
export type DecisionDirection = 'increase' | 'decrease'
export type DecisionCadence = 'off' | 'daily' | 'weekly'
export type ImpactStatus = 'pending' | 'on_track' | 'achieved' | 'missed' | 'regressed'

export interface Decision {
  id: string
  title: string
  insight: string
  action: string
  status: DecisionStatus
  outcome: string
  query_log_id: string | null
  created_at: string
  // Decision Intelligence Loop.
  metric_query: string | null
  metric_column: string | null
  datasource_id: string | null
  predicted_value: number | null
  predicted_direction: DecisionDirection | null
  baseline_value: number | null
  baseline_at: string | null
  realized_value: number | null
  realized_at: string | null
  measure_cadence: DecisionCadence
  impact_status: ImpactStatus
}

export interface DecisionCreate {
  title: string
  insight: string
  action: string
  query_log_id: string | null
  metric_query?: string | null
  metric_column?: string | null
  datasource_id?: string | null
  predicted_value?: number | null
  predicted_direction?: DecisionDirection | null
  measure_cadence?: DecisionCadence | null
}

export interface CounterfactualBand {
  measured_at: string
  yhat: number
  lower: number
  upper: number
}

export interface Counterfactual {
  // "baseline" = no pre-history, absolute change vs baseline (NOT a true
  // counterfactual); otherwise the forecast method that produced the band.
  method: string
  band: CounterfactualBand[] | null
  counterfactual_value: number | null
  delta_vs_counterfactual: number | null
}

export interface DecisionROI {
  decision_id: string
  baseline_value: number | null
  predicted_value: number | null
  realized_value: number | null
  predicted_direction: DecisionDirection | null
  delta_abs: number | null
  delta_pct: number | null
  progress_pct: number | null
  impact_status: ImpactStatus
  baseline_at: string | null
  realized_at: string | null
  counterfactual: Counterfactual | null
}

export interface DecisionMeasurement {
  id: string
  value: number
  measured_at: string
  query_log_id: string | null
}

export interface DecisionTrajectory {
  points: DecisionMeasurement[]
  counterfactual: Counterfactual | null
}

export interface AccuracySummary {
  total_measured: number
  direction_hit_rate: number | null
  achieved: number
  accuracy_pct: number | null
  avg_magnitude_error_pct: number | null
}

export interface EvalCaseDetail {
  nl: string
  passed: boolean
  strict_passed: boolean
  latency_ms: number
  tier: 'easy' | 'medium' | 'hard'
}

export interface EvalRun {
  id: string
  model: string
  mode: 'bare' | 'grounded' | 'history'
  total: number
  passed: number
  exec_accuracy: number
  avg_latency_ms: number
  notes: string
  details: EvalCaseDetail[]
  created_at: string
}

export interface ObservabilitySummary {
  calls: number
  total_tokens: number
  avg_latency_ms: number
  by_kind: Record<string, number>
}

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

export interface DimensionFilter {
  column: string
  values: string[]
}

/** Dashboard-wide filter: a date range on one column + dimension slicers.
 *  Applied server-side to every widget's SQL. */
export interface DashboardFilterSpec {
  date_column?: string | null
  date_start?: string | null
  date_end?: string | null
  dimensions: DimensionFilter[]
}

export interface Dashboard {
  id: string
  name: string
  description: string
  layout: Record<string, unknown> | null
  global_filter?: DashboardFilterSpec | null
  live_enabled?: boolean
  live_interval_seconds?: number
  widgets: Widget[]
}

export interface DashboardSummary {
  id: string
  name: string
  description: string
}

export interface StorySlide {
  type: 'intro' | 'chart' | 'closing'
  title: string
  narrative: string
  widget_id: string | null
}

export interface DataStory {
  title: string
  slides: StorySlide[]
}

export interface AuthUser {
  id: string
  email: string
  full_name: string
  is_active: boolean
  subscription_tier: string
  white_label: boolean
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
  method?: string // "mad" | "mad+isolation_forest"
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

export interface RootCauseNode {
  label: string
  value: number | null
  contribution_pct: number | null
  direction: string
  children: RootCauseNode[]
}

export interface RootCauseResult {
  metric: string
  total: number | null
  summary: string
  drivers: RootCauseNode[]
}

export interface SignificanceCheck {
  name: string
  passed: boolean
  severity: string // "ok" | "warn"
  detail: string
}

export interface SignificanceResult {
  checks: SignificanceCheck[]
  summary: string
}

export type ContractRule = 'not_null' | 'unique' | 'min' | 'max' | 'range' | 'freshness' | 'schema'

export interface Expectation {
  column?: string | null
  rule: ContractRule
  params?: Record<string, number>
}

export interface CheckResult {
  column: string | null
  rule: string
  passed: boolean
  detail: string
}

export interface DataContract {
  id: string
  datasource_id: string
  table_name: string
  name: string
  expectations: Expectation[]
  schema_hash: string | null
  last_status: string // pass | fail | unknown
  last_run_at: string | null
  created_at: string
}

export interface ContractRun {
  id: string
  status: string
  results: CheckResult[]
  created_at: string
}

export interface DataContractCreate {
  datasource_id: string
  table_name: string
  name: string
  expectations: Expectation[]
}

export type TreeOperator = 'add' | 'sub' | 'mul' | 'div'

export interface MetricNode {
  id: string
  parent_id: string | null
  name: string
  operator: TreeOperator
  manual_value: number | null
  position: number
  created_at: string
}

export interface EvaluatedNode {
  id: string
  name: string
  operator: string
  value: number
  manual_value: number | null
  contribution_pct: number | null
  children: EvaluatedNode[]
}

export interface MetricNodeCreate {
  name: string
  parent_id?: string | null
  operator?: TreeOperator
  manual_value?: number | null
}

export interface CausalDriver {
  feature: string
  r: number
  p_value: number
  significant: boolean
  direction: string // "müsbət" | "mənfi"
  strength: string // "zəif" | "orta" | "güclü"
}

export interface CausalResult {
  target: string
  drivers: CausalDriver[]
  summary: string
  caveats: string[]
}

export interface KpiItem {
  name: string
  question: string
  rationale: string
  requirement_ref: string
}

export interface RequirementDoc {
  id: string
  name: string
  kpis: KpiItem[]
  dashboard_id: string | null
  created_at: string
}

export interface DataPrepPreview {
  sql: string
  steps: string[]
  warnings: string[]
  columns: string[]
  rows: Record<string, unknown>[]
}

export interface ColumnProfile {
  column: string
  dtype: string
  null_pct: number
  distinct: number
  min: number | null
  max: number | null
  sample_size: number
}

export interface DataProfile {
  table: string
  row_sample: number
  columns: ColumnProfile[]
}

export interface SnapshotMeta {
  id: string
  label: string
  origin: 'manual' | 'scheduled'
  created_at: string
}

export interface SnapshotWidget {
  widget_id: string
  title: string
  chart_type: string
  chart_config: ChartConfig
  columns: string[]
  rows: Record<string, unknown>[]
}

export interface SnapshotFull {
  id: string
  label: string
  origin: 'manual' | 'scheduled'
  created_at: string
  widgets: SnapshotWidget[]
}

export type GraphNodeType =
  | 'table'
  | 'metric'
  | 'mnode'
  | 'dash'
  | 'widget'
  | 'squery'
  | 'decision'
  | 'ds'

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  ref_id: string | null
}

export interface GraphEdge {
  source: string
  target: string
  kind: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type BAFramework = 'swot' | 'porter' | 'bcg' | 'bpmn'

export interface BAPorterForce {
  key: 'rivalry' | 'new_entrants' | 'supplier_power' | 'buyer_power' | 'substitutes'
  level: 'low' | 'medium' | 'high'
  rationale: string
}

export interface BABcgItem {
  label: string
  share_pct: number
  growth_pct: number
  quadrant: 'star' | 'cash_cow' | 'question' | 'dog'
}

/** Shape depends on framework — see backend ai/ba_frameworks. */
export interface BAContent {
  strengths?: string[]
  weaknesses?: string[]
  opportunities?: string[]
  threats?: string[]
  forces?: BAPorterForce[]
  items?: BABcgItem[]
  thresholds?: { share_pct: number; growth_pct: number }
  mermaid?: string
  summary?: string
  advice?: string
}

export interface BAArtifact {
  id: string
  framework: BAFramework
  title: string
  context: string
  content: BAContent
  created_at: string
}

export interface AutoMLTableColumn {
  name: string
  dtype: string
}

export interface AutoMLTable {
  name: string
  columns: AutoMLTableColumn[]
}

export interface MLFeatureWeight {
  feature: string
  weight: number
}

export interface MLLeaderboardEntry {
  algo: string
  metric: string
  score: number
  f1_macro?: number
  is_best: boolean
}

export interface MLDiagnostics {
  cv?: { metric: string; folds: number; scores: number[]; mean: number; std: number }
  confusion?: { labels: string[]; matrix: number[][] }
  actual_vs_predicted?: { actual: number[]; predicted: number[] }
  permutation_importance?: MLFeatureWeight[]
  /** Per-feature stats used server-side to explain predictions; not read by the UI. */
  explain?: Record<string, unknown>
}

/** One influential feature behind a single prediction. `value` is a number for a
 *  numeric feature, or the category string for a one-hot categorical. */
export interface MLPredictionExplain {
  feature: string
  value: number | string
  influence: number
}

export interface MLModelInfo {
  id: string
  name: string
  source_table: string
  datasource_id: string | null
  target_column: string
  feature_columns: string[]
  problem_type: 'regression' | 'classification'
  best_algo: string
  metrics: Record<string, number>
  importances: MLFeatureWeight[]
  leaderboard: MLLeaderboardEntry[]
  diagnostics: MLDiagnostics
  sklearn_version: string
  row_count: number
  created_at: string
}
