import { LogOut } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

export function TopBar() {
  const { user, logout } = useAuthStore()
  const initial = (user?.full_name || user?.email || '?').charAt(0).toUpperCase()
  return (
    <header className="flex items-center justify-end gap-4 border-b border-grid bg-paper/80 px-8 py-3.5 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="text-sm text-muted">{user?.email ?? ''}</span>
      </div>
      <span className="h-5 w-px bg-grid" />
      <button
        onClick={logout}
        className="flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
      >
        <LogOut size={15} /> Çıxış
      </button>
    </header>
  )
}
