import { create } from 'zustand'
import type { AuthUser } from '../types'
import * as authApi from '../api/auth'

const TOKEN_KEY = 'nexusbi_token'

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
  // Persist a freshly issued token, then hydrate the current user.
  const apply = async (token: string) => {
    localStorage.setItem(TOKEN_KEY, token)
    set({ token })
    set({ user: await authApi.me() })
  }

  return {
    token: localStorage.getItem(TOKEN_KEY),
    user: null,
    loading: false,
    login: async (email, password) => apply(await authApi.login(email, password)),
    register: async (email, password, fullName) =>
      apply(await authApi.register(email, password, fullName)),
    googleLogin: async (credential) => apply(await authApi.googleLogin(credential)),
    loadUser: async () => {
      if (!localStorage.getItem(TOKEN_KEY)) return
      set({ loading: true })
      try {
        set({ user: await authApi.me() })
      } finally {
        set({ loading: false })
      }
    },
    logout: () => {
      localStorage.removeItem(TOKEN_KEY)
      set({ token: null, user: null })
    },
  }
})
