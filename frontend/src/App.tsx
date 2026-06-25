import { lazy, Suspense, useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './pages/LoginPage'
import { useAuthStore } from './store/authStore'

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
  useEffect(() => {
    loadUser().catch(() => undefined)
  }, [loadUser])

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1A1C21',
            color: '#ECEAE6',
            border: '1px solid #2A2E35',
            borderRadius: '12px',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#0E9F6E', secondary: '#131418' } },
        }}
      />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<QueryPage />} />
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
