import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { DashboardPage } from './pages/DashboardPage'
import { HistoryPage } from './pages/HistoryPage'
import { LoginPage } from './pages/LoginPage'
import { QueryPage } from './pages/QueryPage'
import { useAuthStore } from './store/authStore'

function ProtectedRoute() {
  const token = useAuthStore((s) => s.token)
  return token ? <Outlet /> : <Navigate to="/login" replace />
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
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<QueryPage />} />
            <Route path="/dashboards" element={<DashboardPage />} />
            <Route path="/history" element={<HistoryPage />} />
          </Route>
        </Route>
      </Routes>
    </>
  )
}
