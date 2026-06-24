import { LogOut } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'

export function TopBar() {
  const { user, logout } = useAuthStore()
  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-3">
      <h1 className="text-lg font-bold text-brand">NexusBI</h1>
      <div className="flex items-center gap-4 text-sm text-slate-300">
        <span>{user?.email ?? ''}</span>
        <button onClick={logout} className="flex items-center gap-1 hover:text-brand">
          <LogOut size={16} /> Çıxış
        </button>
      </div>
    </header>
  )
}
