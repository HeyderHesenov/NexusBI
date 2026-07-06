import { lazy, Suspense, useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
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
const AIQualityPage = lazy(() =>
  import('./pages/AIQualityPage').then((m) => ({ default: m.AIQualityPage })),
)
const ExperimentsPage = lazy(() =>
  import('./pages/ExperimentsPage').then((m) => ({ default: m.ExperimentsPage })),
)
const InsightsPage = lazy(() =>
  import('./pages/InsightsPage').then((m) => ({ default: m.InsightsPage })),
)
const GraphPage = lazy(() =>
  import('./pages/GraphPage').then((m) => ({ default: m.GraphPage })),
)
const TwinPage = lazy(() =>
  import('./pages/TwinPage').then((m) => ({ default: m.TwinPage })),
)
const BAStudioPage = lazy(() =>
  import('./pages/BAStudioPage').then((m) => ({ default: m.BAStudioPage })),
)
const AutoMLPage = lazy(() =>
  import('./pages/AutoMLPage').then((m) => ({ default: m.AutoMLPage })),
)
const MetricTreePage = lazy(() =>
  import('./pages/MetricTreePage').then((m) => ({ default: m.MetricTreePage })),
)
const DataContractsPage = lazy(() =>
  import('./pages/DataContractsPage').then((m) => ({ default: m.DataContractsPage })),
)
const RequirementsPage = lazy(() =>
  import('./pages/RequirementsPage').then((m) => ({ default: m.RequirementsPage })),
)
const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })),
)
const TargetsPage = lazy(() =>
  import('./pages/TargetsPage').then((m) => ({ default: m.TargetsPage })),
)
const BrandingPage = lazy(() =>
  import('./pages/BrandingPage').then((m) => ({ default: m.BrandingPage })),
)
const EmbedDashboardPage = lazy(() =>
  import('./pages/EmbedDashboardPage').then((m) => ({ default: m.EmbedDashboardPage })),
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
      <ErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/public/:token" element={<PublicDashboardPage />} />
          <Route path="/embed/:token" element={<EmbedDashboardPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<QueryPage />} />
              <Route path="/sources" element={<DataSourcesPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/decisions" element={<DecisionsPage />} />
              <Route path="/experiments" element={<ExperimentsPage />} />
              <Route path="/insights" element={<InsightsPage />} />
              <Route path="/graph" element={<GraphPage />} />
              <Route path="/twin" element={<TwinPage />} />
              <Route path="/ba-studio" element={<BAStudioPage />} />
              <Route path="/automl" element={<AutoMLPage />} />
              <Route path="/metric-tree" element={<MetricTreePage />} />
              <Route path="/contracts" element={<DataContractsPage />} />
              <Route path="/metrics" element={<MetricsPage />} />
              <Route path="/requirements" element={<RequirementsPage />} />
              <Route path="/workspaces" element={<WorkspacePage />} />
              <Route path="/ai-quality" element={<AIQualityPage />} />
              <Route path="/targets" element={<TargetsPage />} />
              <Route path="/branding" element={<BrandingPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/dashboards" element={<DashboardPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/pricing" element={<PricingPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </>
  )
}
