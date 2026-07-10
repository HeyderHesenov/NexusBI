import { useEffect, useState } from 'react'
import type { AuthUser } from '../types'
import { useAuthStore } from '../store/authStore'
import { useQueryStore } from '../store/queryStore'
import { useDashboardStore } from '../store/dashboardStore'
import { useSavedQueryStore } from '../store/savedQueryStore'
import { useDatasourceStore } from '../store/datasourceStore'

const DEMO_EMAIL = 'demo@nexusbi.io'
const dismissKey = (userId: string) => `nexusbi.onboarding.dismissed.${userId}`
// A dismissal (explicit close OR everything completed) is stored per user id so a
// shared browser never leaks one account's onboarding state to another.
const readDismissed = (user: AuthUser | null) =>
  !!user && localStorage.getItem(dismissKey(user.id)) === '1'
const writeDismissed = (user: AuthUser | null) => {
  if (user) localStorage.setItem(dismissKey(user.id), '1')
}

export type OnboardingStepKey = 'source' | 'query' | 'save' | 'dashboard'

export interface OnboardingStep {
  key: OnboardingStepKey
  done: boolean
}

export interface Onboarding {
  visible: boolean
  steps: OnboardingStep[]
  completed: number
  total: number
  dismiss: () => void
}

/** First-run checklist state, DERIVED from existing stores (no new persistence
 *  beyond a per-user dismissal flag). Completion is read from the datasource /
 *  history / saved-query / dashboard counts the app already loads, so the steps
 *  tick off as the user actually does the work. Hidden for the demo account and
 *  once every step is done (persisted) or the user dismisses it. */
export function useOnboarding(): Onboarding {
  const user = useAuthStore((s) => s.user)
  const history = useQueryStore((s) => s.history)
  const dashboards = useDashboardStore((s) => s.list)
  const saved = useSavedQueryStore((s) => s.items)
  const sources = useDatasourceStore((s) => s.sources)
  const loadDashboards = useDashboardStore((s) => s.loadList)
  const loadSaved = useSavedQueryStore((s) => s.load)

  const isDemo = user?.email === DEMO_EMAIL
  // Read the flag SYNCHRONOUSLY on mount (not in an effect) so a returning or
  // dismissed user never triggers the load effect below for one wasted round.
  const [dismissed, setDismissed] = useState(() => readDismissed(user))
  useEffect(() => setDismissed(readDismissed(user)), [user])

  const active = !!user && !isDemo && !dismissed

  // Pull the two lists the checklist needs that the query console doesn't fetch
  // on its own — history is loaded by QueryPage and sources by DatasourcePicker,
  // so we deliberately don't re-request those here. Fresh each mount (no length
  // guard) so an account switch can't surface the previous user's counts.
  useEffect(() => {
    if (!active) return
    loadDashboards().catch(() => undefined)
    loadSaved().catch(() => undefined)
  }, [active, loadDashboards, loadSaved])

  const steps: OnboardingStep[] = [
    { key: 'source', done: sources.length > 0 },
    { key: 'query', done: history.length > 0 },
    { key: 'save', done: saved.length > 0 },
    { key: 'dashboard', done: dashboards.length > 0 },
  ]
  const completed = steps.filter((s) => s.done).length
  const allDone = completed === steps.length

  // Persist completion like a dismissal so a finished user is neither re-fetched
  // nor re-shown the card on later visits.
  useEffect(() => {
    if (active && allDone && user) {
      writeDismissed(user)
      setDismissed(true)
    }
  }, [active, allDone, user])

  const dismiss = () => {
    writeDismissed(user)
    setDismissed(true)
  }

  const visible = active && !allDone
  return { visible, steps, completed, total: steps.length, dismiss }
}
