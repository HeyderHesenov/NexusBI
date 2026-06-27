import { client } from './client'

export interface CopilotAction {
  type: string
  label: string
  dashboard_id?: string | null
  query_log_id?: string | null
}

export interface CopilotResponse {
  reply: string
  actions: CopilotAction[]
  steps: number
}

export interface CopilotHistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

export async function copilotChat(
  message: string,
  history: CopilotHistoryTurn[],
): Promise<CopilotResponse> {
  const { data } = await client.post<CopilotResponse>('/copilot/chat', { message, history })
  return data
}
