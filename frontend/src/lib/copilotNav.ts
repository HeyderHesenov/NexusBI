import type { CopilotAction } from '../api/copilot'

/** Copilot action chip → route. Id-keyed entries win; type-keyed entries cover
 * chips without their own page object (digest, twin).
 * BA/AutoML deep-open the created object via ?open= (their pages read it). */
export function copilotNavTarget(a: CopilotAction): string | null {
  if (a.ml_model_id) return `/automl?open=${a.ml_model_id}`
  if (a.ba_artifact_id) return `/ba-studio?open=${a.ba_artifact_id}`
  if (a.experiment_id) return '/experiments'
  if (a.decision_id) return '/decisions'
  if (a.contract_id) return '/contracts'
  if (a.dashboard_id) return '/dashboards'
  if (a.query_log_id) return '/history'
  if (a.saved_query_id) return '/reports'
  if (a.metric_id) return '/metrics'
  switch (a.type) {
    case 'metric_tree': // the tree editor now lives inside the Twin page
      return '/twin'
    case 'twin':
      return '/twin'
    case 'digest':
      return '/notifications'
    default:
      return null
  }
}
