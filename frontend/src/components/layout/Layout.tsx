import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useChatUnreadStore } from '../../store/chatUnreadStore'
import { tokenStore } from '../../api/client'
import { CopilotWidget } from '../copilot/CopilotWidget'
import { SearchPalette } from '../search/SearchPalette'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function Layout() {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const start = useChatUnreadStore((s) => s.start)
  const stop = useChatUnreadStore((s) => s.stop)

  // Layout only mounts inside ProtectedRoute, so this is the app's "signed in"
  // boundary — the mailbox socket lives exactly as long as the session.
  useEffect(() => {
    start().catch(() => undefined)
    // Logging out in ANOTHER tab is a pure localStorage change here: this tab never
    // unmounts, so without this its socket would stay open and keep toasting message
    // previews into a session whose tokens are gone.
    const onStorage = (e: StorageEvent) => {
      if (e.key === tokenStore.KEY && !e.newValue) stop()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      stop()
    }
  }, [start, stop])

  return (
    <div className="flex h-screen bg-bg text-ink">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <div className="mx-auto flex min-h-full max-w-[1500px] flex-col px-8 py-9">
            {/* A render error in one page must not white-screen the whole app;
                navigating to another route clears it. */}
            <ErrorBoundary resetKeys={[pathname]} label={t('layout.pageLabel')}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <CopilotWidget />
      <SearchPalette />
    </div>
  )
}
