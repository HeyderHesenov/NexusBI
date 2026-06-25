import { LogOut, Moon, Sun } from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { UsageMeter } from '../billing/UsageMeter'

export function TopBar() {
  const { user, logout } = useAuthStore()
  const { mode, toggle } = useThemeStore()
  const initial = (user?.full_name || user?.email || '?').charAt(0).toUpperCase()
  return (
    <header className="flex items-center justify-end gap-4 border-b border-line bg-bg/70 px-8 py-3.5 backdrop-blur">
      <UsageMeter />
      <button
        onClick={toggle}
        aria-label={mode === 'dark' ? 'İşıqlı tema' : 'Tünd tema'}
        title={mode === 'dark' ? 'İşıqlı tema' : 'Tünd tema'}
        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
      >
        {mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <span className="h-5 w-px bg-line" />
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-semibold text-bg">
          {initial}
        </span>
        <span className="text-sm text-ink-soft">{user?.email ?? ''}</span>
      </div>
      <span className="h-5 w-px bg-line" />
      <button
        onClick={logout}
        className="flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
      >
        <LogOut size={15} /> Çıxış
      </button>
    </header>
  )
}
