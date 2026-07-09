import { useEffect } from 'react'
import { useTargetStore } from '../store/targetStore'
import type { KPITarget } from '../api/scenario'

/** Saved KPI targets for chart surfaces: subscribes to the store and triggers
 *  the (deduped) load once on mount. Authed pages only — public/embed
 *  surfaces must not call this. */
export function useKpiTargets(): KPITarget[] {
  const items = useTargetStore((s) => s.items)
  const load = useTargetStore((s) => s.load)
  useEffect(() => {
    load().catch(() => {}) // best-effort: charts render fine without targets
  }, [load])
  return items
}
