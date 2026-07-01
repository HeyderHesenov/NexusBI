import { useEffect } from 'react'
import { Bell, Moon, Search, Sun } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useThemeStore } from '../../store/themeStore'
import { useNotificationStore } from '../../store/notificationStore'
import { useSearchStore } from '../../store/searchStore'
import { LanguageSwitcher } from './LanguageSwitcher'

// Route → başlıq açarı: header solunu doldurur, naviqasiya kontekstini göstərir.
const TITLE_KEYS: Array<[string, string]> = [
  ['/sources', 'title.sources'],
  ['/reports', 'title.reports'],
  ['/decisions', 'title.decisions'],
  ['/metrics', 'title.metrics'],
  ['/requirements', 'title.requirements'],
  ['/workspaces', 'title.workspaces'],
  ['/targets', 'title.targets'],
  ['/branding', 'title.branding'],
  ['/notifications', 'title.notifications'],
  ['/dashboards', 'title.dashboards'],
  ['/history', 'title.history'],
  ['/pricing', 'title.pricing'],
  ['/', 'title.home'],
]

function titleKeyFor(pathname: string): string {
  return (
    TITLE_KEYS.find(([prefix]) => (prefix === '/' ? pathname === '/' : pathname.startsWith(prefix)))?.[1] ??
    'title.fallback'
  )
}

export function TopBar() {
  const { t } = useTranslation()
  const { mode, toggle } = useThemeStore()
  const { unread, load } = useNotificationStore()
  const openSearch = useSearchStore((s) => s.setOpen)
  const { pathname } = useLocation()

  useEffect(() => {
    load().catch(() => undefined)
    // Light polling so smart-insight notifications surface without a refresh.
    const id = setInterval(() => load().catch(() => undefined), 60_000)
    return () => clearInterval(id)
  }, [load])

  return (
    <header className="relative z-30 flex items-center justify-between gap-4 border-b border-line bg-bg/70 px-8 py-3.5 backdrop-blur">
      <h2 className="min-w-0 truncate font-display text-base font-semibold tracking-tight text-ink">
        {t(titleKeyFor(pathname))}
      </h2>
      <div className="flex items-center gap-4">
      <button
        onClick={() => openSearch(true)}
        aria-label={t('topbar.search')}
        title={t('topbar.searchTitle')}
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-faint transition-colors hover:border-line-strong hover:text-ink-soft focus-visible:border-accent focus-visible:outline-none md:w-64 md:justify-start md:gap-2 md:bg-surface md:px-3"
      >
        <Search size={14} className="shrink-0" />
        <span className="hidden flex-1 text-left text-sm md:inline">{t('topbar.search')}</span>
        <kbd className="hidden shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] md:inline">
          ⌘K
        </kbd>
      </button>
      <Link
        to="/notifications"
        aria-label={t('topbar.notifications')}
        title={t('topbar.notifications')}
        className="relative grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-semibold text-bg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </Link>
      <LanguageSwitcher />
      <button
        onClick={toggle}
        aria-label={mode === 'dark' ? t('topbar.lightTheme') : t('topbar.darkTheme')}
        title={mode === 'dark' ? t('topbar.lightTheme') : t('topbar.darkTheme')}
        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
      >
        {mode === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      </div>
    </header>
  )
}
