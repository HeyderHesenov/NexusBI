import { BookMarked, CreditCard, Database, History, LayoutDashboard, MessageSquare, Tag } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { NexusMark } from '../brand/NexusMark'
import { useDatasourceStore } from '../../store/datasourceStore'
import { useQueryStore } from '../../store/queryStore'

const items = [
  { to: '/', label: 'Soruş', icon: MessageSquare },
  { to: '/sources', label: 'Mənbələr', icon: Database },
  { to: '/metrics', label: 'Metriklər', icon: Tag },
  { to: '/dashboards', label: 'Dashboard-lar', icon: LayoutDashboard },
  { to: '/reports', label: 'Hesabatlar', icon: BookMarked },
  { to: '/history', label: 'Tarixçə', icon: History },
  { to: '/pricing', label: 'Planlar', icon: CreditCard },
]

export function Sidebar() {
  const datasourceId = useQueryStore((s) => s.datasourceId)
  const sources = useDatasourceStore((s) => s.sources)
  const active = sources.find((s) => s.id === datasourceId)
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center gap-2.5 px-6 py-6">
        <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface-2">
          <NexusMark size={20} />
        </span>
        <div className="leading-none">
          <span className="font-display text-lg font-bold tracking-tight text-ink">
            Nexus<span className="text-accent">BI</span>
          </span>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-ink-faint">
            words → data
          </p>
        </div>
      </div>

      <nav className="mt-1 flex flex-col gap-0.5 px-3">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-accent-soft text-ink'
                  : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                )}
                <Icon
                  size={17}
                  strokeWidth={2}
                  className={isActive ? 'text-accent' : ''}
                />
                <span className="font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto px-5 py-5">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_6px_rgb(var(--accent))]" />
          <span className="truncate font-mono text-[10px] uppercase tracking-wider text-ink-soft">
            {active ? active.name : 'Demo mode'}
          </span>
        </div>
      </div>
    </aside>
  )
}
