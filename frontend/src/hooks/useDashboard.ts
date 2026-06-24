import { useDashboardStore } from '../store/dashboardStore'

export function useDashboard() {
  const { list, current, loadList, open, create } = useDashboardStore()
  return { list, current, loadList, open, create }
}
