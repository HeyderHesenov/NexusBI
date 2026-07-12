import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CopilotAction } from '../api/copilot'
import { copilotNavTarget } from '../lib/copilotNav'
import { useDashboardStore } from '../store/dashboardStore'

/** Navigate to whatever a copilot action chip points at.
 *
 * Shared by the floating CopilotWidget and the chat AI assistant so a chip
 * behaves identically wherever it renders: dashboard chips preload the list
 * and open the target before routing. `onNavigate` lets the caller close its
 * panel after the jump. */
export function useCopilotAction(onNavigate?: () => void) {
  const navigate = useNavigate()
  return useCallback(
    async (a: CopilotAction) => {
      const target = copilotNavTarget(a)
      if (!target) return
      if (a.dashboard_id) {
        await useDashboardStore.getState().loadList().catch(() => undefined)
        await useDashboardStore.getState().open(a.dashboard_id).catch(() => undefined)
      }
      navigate(target)
      onNavigate?.()
    },
    [navigate, onNavigate],
  )
}
