import { lazy, Suspense, useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './pages/LoginPage'
import { useAuthStore } from './store/authStore'
import { useThemeStore } from './store/themeStore'

// Theme-aware toast palette (terracotta accent on warm paper / graphite).
const TOAST_THEME = {
  light: { bg: '#FFFFFF', text: '#1F1E1D', line: '#E5E3DC', accent: '#0E9F6E' },
  dark: { bg: '#1F1E1D', text: '#EDEAE6', line: '#3A3733', accent: '#10B981' },
}

// Login is the entry route — load it eagerly so first paint (and its reveal
// animation) is instant, with no Suspense flash. Authed pages stay split.
const QueryPage = lazy(() => import('./pages/QueryPage').then((m) => ({ default: m.QueryPage })))
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
)
const PricingPage = lazy(() =>
  import('./pages/PricingPage').then((m) => ({ default: m.PricingPage })),
)
const DataSourcesPage = lazy(() =>
  import('./pages/DataSourcesPage').then((m) => ({ default: m.DataSourcesPage })),
)
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
)
const MetricsPage = lazy(() =>
  import('./pages/MetricsPage').then((m) => ({ default: m.MetricsPage })),
)
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
)
const PublicDashboardPage = lazy(() =>
  import('./pages/PublicDashboardPage').then((m) => ({ default: m.PublicDashboardPage })),
)
const DecisionsPage = lazy(() =>
  import('./pages/DecisionsPage').then((m) => ({ default: m.DecisionsPage })),
)

function ProtectedRoute() {
  const token = useAuthStore((s) => s.token)
  return token ? <Outlet /> : <Navigate to="/login" replace />
}

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <span className="h-2 w-2 animate-ping rounded-full bg-accent" />
    </div>
  )
}

export default function App() {
  const loadUser = useAuthStore((s) => s.loadUser)
  const mode = useThemeStore((s) => s.mode)
  const t = TOAST_THEME[mode]
  useEffect(() => {
    loadUser().catch(() => undefined)
  }, [loadUser])

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: t.bg,
            color: t.text,
            border: `1px solid ${t.line}`,
            borderRadius: '12px',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: t.accent, secondary: t.bg } },
        }}
      />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/public/:token" element={<PublicDashboardPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<QueryPage />} />
              <Route path="/sources" element={<DataSourcesPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/decisions" element={<DecisionsPage />} />
              <Route path="/metrics" element={<MetricsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/dashboards" element={<DashboardPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/pricing" element={<PricingPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}
