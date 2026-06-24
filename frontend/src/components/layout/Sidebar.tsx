import { History, LayoutDashboard, MessageSquare } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const items = [
  { to: '/', label: 'Soruş', icon: MessageSquare, n: '01' },
  { to: '/dashboards', label: 'Dashboard-lar', icon: LayoutDashboard, n: '02' },
  { to: '/history', label: 'Tarixçə', icon: History, n: '03' },
]

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-brand text-white">
      <div className="px-6 py-6">
        <span className="font-display text-2xl font-bold tracking-tight text-white">
          Nexus<span className="text-signal">BI</span>
        </span>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
          words → data
        </p>
      </div>

      <nav className="mt-2 flex flex-col gap-0.5 px-3">
        {items.map(({ to, label, icon: Icon, n }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`font-mono text-[10px] ${
                    isActive ? 'text-signal' : 'text-white/30'
                  }`}
                >
                  {n}
                </span>
                <Icon size={17} strokeWidth={2} />
                <span className="font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto px-6 py-5">
        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/55">
            Demo mode
          </span>
        </div>
      </div>
    </aside>
  )
}
