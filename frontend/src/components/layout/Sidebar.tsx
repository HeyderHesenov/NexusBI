import { BookMarked, CreditCard, Database, FileText, FlaskConical, Gauge, History, LayoutDashboard, MessageSquare, Palette, Tag, Target, Users } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { NexusMark } from '../brand/NexusMark'
import { useDatasourceStore } from '../../store/datasourceStore'
import { useQueryStore } from '../../store/queryStore'

const groups = [
  {
    title: 'Analiz',
    items: [
      { to: '/', label: 'Soruş', icon: MessageSquare },
      { to: '/history', label: 'Tarixçə', icon: History },
    ],
  },
  {
    title: 'Məlumat',
    items: [
      { to: '/sources', label: 'Mənbələr', icon: Database },
      { to: '/metrics', label: 'Metriklər', icon: Tag },
      { to: '/requirements', label: 'Tələblər', icon: FileText },
    ],
  },
  {
    title: 'Vizuallaşdırma',
    items: [
      { to: '/dashboards', label: 'Dashboard-lar', icon: LayoutDashboard },
      { to: '/reports', label: 'Hesabatlar', icon: BookMarked },
    ],
  },
  {
    title: 'Planlama',
    items: [
      { to: '/decisions', label: 'Qərarlar', icon: Target },
      { to: '/targets', label: 'Hədəflər', icon: Gauge },
      { to: '/experiments', label: 'A/B testlər', icon: FlaskConical },
    ],
  },
  {
    title: 'İdarəetmə',
    items: [
      { to: '/workspaces', label: 'Komanda', icon: Users },
      // AI Keyfiyyət operator/developer alətidir — əsas naviqasiyadan çıxarıldı;
      // route qalır, yalnız /ai-quality URL-i ilə əlçatandır.
      { to: '/branding', label: 'Brendinq', icon: Palette },
      { to: '/pricing', label: 'Planlar', icon: CreditCard },
    ],
  },
]

export function Sidebar() {
  const datasourceId = useQueryStore((s) => s.datasourceId)
  const sources = useDatasourceStore((s) => s.sources)
  const active = sources.find((s) => s.id === datasourceId)
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex shrink-0 items-center gap-2.5 px-6 py-6">
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

      <nav className="mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-3">
        {groups.map((group, gi) => (
          <div key={group.title} className={gi === 0 ? '' : 'mt-5'}>
            <span className="eyebrow block px-3 pb-1.5">{group.title}</span>
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ to, label, icon: Icon }) => (
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
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 px-5 py-5">
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
