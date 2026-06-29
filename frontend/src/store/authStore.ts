import { create } from 'zustand'
import type { AuthUser } from '../types'
import * as authApi from '../api/auth'
import { tokenStore } from '../api/client'

interface AuthState {
  token: string | null
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName: string) => Promise<void>
  googleLogin: (credential: string) => Promise<void>
  loadUser: () => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => {
  // Persist a freshly issued access+refresh pair, then hydrate the current user.
  const apply = async (pair: authApi.TokenPair) => {
    tokenStore.set(pair.access_token, pair.refresh_token)
    set({ token: pair.access_token })
    set({ user: await authApi.me() })
  }

  return {
    token: tokenStore.access(),
    user: null,
    loading: false,
    login: async (email, password) => apply(await authApi.login(email, password)),
    register: async (email, password, fullName) =>
      apply(await authApi.register(email, password, fullName)),
    googleLogin: async (credential) => apply(await authApi.googleLogin(credential)),
    loadUser: async () => {
      if (!tokenStore.access()) return
      set({ loading: true })
      try {
        set({ user: await authApi.me() })
      } finally {
        set({ loading: false })
      }
    },
    logout: () => {
      // Best-effort server-side revocation so the refresh token can't be reused.
      const refresh = tokenStore.refresh()
      if (refresh) authApi.logout(refresh).catch(() => undefined)
      tokenStore.clear()
      set({ token: null, user: null })
    },
  }
})
