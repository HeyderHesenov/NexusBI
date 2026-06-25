import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { useBillingStore } from '../../store/billingStore'

export function UsageMeter() {
  const { usage, loadUsage } = useBillingStore()

  useEffect(() => {
    loadUsage().catch(() => undefined)
  }, [loadUsage])

  if (!usage) return null

  const unlimited = usage.limit < 0

  if (unlimited) {
    return (
      <Link
        to="/pricing"
        title="Plan və istifadə"
        className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 transition-colors hover:border-accent"
      >
        <Zap size={13} className="text-accent" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
          {usage.tier_name}
        </span>
        <span className="font-mono text-[11px] text-accent">∞</span>
      </Link>
    )
  }

  const pct = usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0
  const low = usage.remaining <= Math.max(1, usage.limit * 0.1)

  return (
    <Link
      to="/pricing"
      title="Plan və istifadə"
      className="group flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-1.5 transition-colors hover:border-line-strong"
    >
      <Zap size={13} className="text-accent" />
      <div className="leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">
            {usage.tier_name}
          </span>
          <span className="font-mono text-[10px] text-ink-faint">
            {usage.used}/{usage.limit}
          </span>
        </div>
        <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-line">
          <div
            className={`h-full rounded-full ${low ? 'bg-amber-500' : 'bg-accent'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </Link>
  )
}
