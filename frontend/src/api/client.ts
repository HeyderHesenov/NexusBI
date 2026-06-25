import axios from 'axios'
import toast from 'react-hot-toast'

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'

export const client = axios.create({ baseURL })

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('nexusbi_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Requests whose 401 is an expected outcome (bad credentials / not-logged-in),
// not an expired session — let the caller handle these instead of redirecting.
const AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/google', '/auth/me']

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const url: string = error.config?.url ?? ''
    const isAuthRequest = AUTH_PATHS.some((p) => url.includes(p))
    const detail =
      error.response?.data?.message ??
      error.response?.data?.detail ??
      'Naməlum xəta baş verdi.'

    if (status === 401 && !isAuthRequest) {
      // A real expired session on a protected call — log out and bounce to login.
      localStorage.removeItem('nexusbi_token')
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
    } else if (status === 429) {
      // Quota exhausted — nudge the user toward an upgrade.
      toast.error('Aylıq AI limitiniz doldu. Planınızı yüksəldin.')
      if (!window.location.pathname.includes('/pricing')) {
        window.location.href = '/pricing'
      }
    } else if (!isAuthRequest) {
      toast.error(typeof detail === 'string' ? detail : 'Xəta baş verdi.')
    }
    // Auth-request errors propagate to the page, which shows them inline.
    return Promise.reject(error)
  },
)
