import { useEffect } from 'react'
import { Bell, LogOut, Moon, Search, Sun } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { useNotificationStore } from '../../store/notificationStore'
import { useSearchStore } from '../../store/searchStore'
import { UsageMeter } from '../billing/UsageMeter'

// Route → başlıq: header solunu doldurur, naviqasiya kontekstini göstərir.
const TITLES: Array<[string, string]> = [
  ['/sources', 'Data mənbələri'],
  ['/reports', 'Hesabatlar'],
  ['/decisions', 'Qərarlar'],
  ['/metrics', 'Metriklər'],
  ['/requirements', 'Tələbnamələr'],
  ['/workspaces', 'Workspace-lər'],
  ['/targets', 'KPI hədəflər'],
  ['/branding', 'Brendinq'],
  ['/notifications', 'Bildirişlər'],
  ['/dashboards', 'Dashboardlar'],
  ['/history', 'Tarixçə'],
  ['/pricing', 'Planlar'],
  ['/', 'Sorğu'],
]

function titleFor(pathname: string): string {
  return TITLES.find(([prefix]) => prefix === '/' ? pathname === '/' : pathname.startsWith(prefix))?.[1] ?? 'NexusBI'
}

export function TopBar() {
  const { user, logout } = useAuthStore()
  const { mode, toggle } = useThemeStore()
  const { unread, load } = useNotificationStore()
  const openSearch = useSearchStore((s) => s.setOpen)
  const { pathname } = useLocation()
  const initial = (user?.full_name || user?.email || '?').charAt(0).toUpperCase()

  useEffect(() => {
    load().catch(() => undefined)
    // Light polling so smart-insight notifications surface without a refresh.
    const id = setInterval(() => load().catch(() => undefined), 60_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <header className="flex items-center justify-between gap-4 border-b border-line bg-bg/70 px-8 py-3.5 backdrop-blur">
      <h2 className="truncate font-display text-base font-semibold tracking-tight text-ink">
        {titleFor(pathname)}
      </h2>
      <div className="flex items-center gap-4">
      <button
        onClick={() => openSearch(true)}
        aria-label="Axtar"
        title="Axtar (⌘K)"
        className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-ink-faint transition-colors hover:border-line-strong hover:text-ink"
      >
        <Search size={14} />
        <kbd className="hidden font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>
      <UsageMeter />
      <Link
        to="/notifications"
        aria-label="Bildirişlər"
        title="Bildirişlər"
        className="relative grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-semibold text-bg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>
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
      </div>
    </header>
  )
}
