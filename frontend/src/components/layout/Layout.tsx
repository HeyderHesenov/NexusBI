import { Outlet } from 'react-router-dom'
import { CopilotWidget } from '../copilot/CopilotWidget'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

export function Layout() {
  return (
    <div className="flex h-screen bg-bg text-ink">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl px-8 py-9">
            <Outlet />
          </div>
        </main>
      </div>
      <CopilotWidget />
    </div>
  )
}
