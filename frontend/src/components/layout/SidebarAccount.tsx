import { LogOut, Zap } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { formatUsage } from '../../lib/usageFormat'
import { useAuthStore } from '../../store/authStore'
import { useBillingStore } from '../../store/billingStore'

/** Bottom-left account footer (Claude-desktop style): plan + usage limit ABOVE the
 * user's name, with logout. Single source of account/plan info (not in TopBar). */
export function SidebarAccount() {
  const { user, logout } = useAuthStore()
  const { usage, loadUsage } = useBillingStore()

  useEffect(() => {
    loadUsage().catch(() => undefined)
  }, [loadUsage])

  const u = formatUsage(usage)
  const name = user?.full_name || user?.email || ''
  const initial = name.charAt(0).toUpperCase() || '?'

  return (
    <div className="shrink-0 border-t border-line px-3 py-3">
      {/* Plan + limit — above the name, per the account layout. */}
      {u && (
        <Link
          to="/pricing"
          title="Plan və istifadə"
          className="mb-2 block rounded-lg border border-line bg-surface-2 px-3 py-2 transition-colors hover:border-line-strong focus-visible:border-accent focus-visible:outline-none"
        >
          <div className="flex items-center gap-2">
            <Zap size={13} className="shrink-0 text-accent" />
            <span className="flex-1 truncate text-xs font-medium text-ink">{u.tierName}</span>
            <span className="font-mono text-[11px] text-ink-faint">
              {u.unlimited ? '∞' : `${u.used}/${u.limit}`}
            </span>
          </div>
          {!u.unlimited && (
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-line">
              <div
                className={`h-full rounded-full ${u.low ? 'bg-amber-500' : 'bg-accent'}`}
                style={{ width: `${u.pct}%` }}
              />
            </div>
          )}
        </Link>
      )}

      {/* Account row */}
      <div className="flex items-center gap-2.5 px-1">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-bg">
          {initial}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          {user?.full_name && <p className="truncate text-[11px] text-ink-faint">{user.email}</p>}
        </div>
        <button
          onClick={logout}
          aria-label="Çıxış"
          title="Çıxış"
          className="shrink-0 rounded-md p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink focus-visible:text-ink focus-visible:outline-none"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  )
}
