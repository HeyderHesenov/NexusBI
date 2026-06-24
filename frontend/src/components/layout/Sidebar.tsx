import { LayoutDashboard, History, MessageSquare } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const items = [
  { to: '/', label: 'Sorğu', icon: MessageSquare },
  { to: '/dashboards', label: 'Dashboard-lar', icon: LayoutDashboard },
  { to: '/history', label: 'Tarixçə', icon: History },
]

export function Sidebar() {
  return (
    <aside className="w-56 border-r border-slate-800 bg-slate-900 p-4">
      <nav className="flex flex-col gap-1">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                isActive ? 'bg-brand/20 text-brand' : 'text-slate-300 hover:bg-slate-800'
              }`
            }
          >
            <Icon size={18} /> {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
