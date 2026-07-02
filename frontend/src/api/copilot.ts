import { client } from './client'

export interface CopilotAction {
  type: string
  label: string
  dashboard_id?: string | null
  query_log_id?: string | null
  saved_query_id?: string | null
  metric_id?: string | null
  ml_model_id?: string | null
  ba_artifact_id?: string | null
  experiment_id?: string | null
  decision_id?: string | null
  contract_id?: string | null
}

export interface CopilotPlanStep {
  tool: string
  summary: string
}

export interface CopilotResponse {
  reply: string
  actions: CopilotAction[]
  plan: CopilotPlanStep[]
  steps: number
}

export interface CopilotHistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

export type CopilotMode = 'plan' | 'execute'

export async function copilotChat(
  message: string,
  history: CopilotHistoryTurn[],
  mode: CopilotMode = 'execute',
  plan: CopilotPlanStep[] = [],
): Promise<CopilotResponse> {
  const { data } = await client.post<CopilotResponse>('/copilot/chat', {
    message,
    history,
    mode,
    plan,
  })
  return data
}
