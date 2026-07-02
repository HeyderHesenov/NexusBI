import axios, { type AxiosRequestConfig } from 'axios'
import toast from 'react-hot-toast'

const baseURL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1'

const TOKEN_KEY = 'nexusbi_token'
const REFRESH_KEY = 'nexusbi_refresh'

export const tokenStore = {
  access: () => localStorage.getItem(TOKEN_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  set(access: string, refresh?: string | null) {
    localStorage.setItem(TOKEN_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

export const client = axios.create({ baseURL })

client.interceptors.request.use((config) => {
  const token = tokenStore.access()
  if (token) config.headers.Authorization = `Bearer ${token}`
  // Carry the active UI language so the backend localizes messages and NEW AI
  // prose (insights, stories, copilot) is generated in the same language.
  config.headers['X-Lang'] = localStorage.getItem('nexusbi_lang') || 'az'
  return config
})

// 401 here means bad credentials / a doomed refresh — never try to refresh.
const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/google', '/auth/refresh']
// Errors shown inline by the page (no toast).
const INLINE_ERROR_PATHS = ['/query/ask', '/retry']

// Single-flight refresh: many concurrent 401s share one /auth/refresh round-trip.
let refreshing: Promise<string> | null = null

async function runRefresh(): Promise<string> {
  const refresh = tokenStore.refresh()
  if (!refresh) throw new Error('no refresh token')
  // Bare axios (no interceptors) so a 401 from /auth/refresh can't recurse.
  const { data } = await axios.post(`${baseURL}/auth/refresh`, { refresh_token: refresh })
  tokenStore.set(data.access_token, data.refresh_token)
  return data.access_token as string
}

function forceLogout() {
  tokenStore.clear()
  if (!window.location.pathname.includes('/login')) window.location.href = '/login'
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
    const url: string = original?.url ?? ''
    const noRefresh = NO_REFRESH_PATHS.some((p) => url.includes(p))
    const isInlineError = INLINE_ERROR_PATHS.some((p) => url.includes(p))

    // Expired access token on a protected call → try one refresh, then retry once.
    if (status === 401 && original && !noRefresh && !original._retry && tokenStore.refresh()) {
      original._retry = true
      try {
        refreshing = refreshing ?? runRefresh()
        const access = await refreshing
        refreshing = null
        original.headers = { ...original.headers, Authorization: `Bearer ${access}` }
        return client(original)
      } catch {
        refreshing = null
        forceLogout()
        return Promise.reject(error)
      }
    }

    if (status === 401 && !noRefresh) {
      forceLogout()
    } else if (status === 429 && error.response?.data?.code === 'ai_quota') {
      // Only the MONTHLY AI QUOTA sends users to pricing — transient per-IP
      // throttles (SQL runs, AutoML train/predict) fall through to the plain
      // error toast below; an upgrade wouldn't fix those.
      toast.error('Aylıq AI limitiniz doldu. Planınızı yüksəldin.')
      if (!window.location.pathname.includes('/pricing')) window.location.href = '/pricing'
    } else if (!noRefresh && !isInlineError) {
      const detail =
        error.response?.data?.message ??
        error.response?.data?.detail ??
        'Naməlum xəta baş verdi.'
      toast.error(typeof detail === 'string' ? detail : 'Xəta baş verdi.')
    }
    return Promise.reject(error)
  },
)
