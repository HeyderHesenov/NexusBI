import { Outlet, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CopilotWidget } from '../copilot/CopilotWidget'
import { SearchPalette } from '../search/SearchPalette'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function Layout() {
  const { pathname } = useLocation()
  const { t } = useTranslation()
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
