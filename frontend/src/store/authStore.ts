import { create } from 'zustand'
import type { AuthUser } from '../types'
import * as authApi from '../api/auth'

interface AuthState {
  token: string | null
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName: string) => Promise<void>
  loadUser: () => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('nexusbi_token'),
  user: null,
  loading: false,
  login: async (email, password) => {
    const token = await authApi.login(email, password)
    localStorage.setItem('nexusbi_token', token)
    set({ token })
    const user = await authApi.me()
    set({ user })
  },
  register: async (email, password, fullName) => {
    const token = await authApi.register(email, password, fullName)
    localStorage.setItem('nexusbi_token', token)
    set({ token })
    const user = await authApi.me()
    set({ user })
  },
  loadUser: async () => {
    if (!localStorage.getItem('nexusbi_token')) return
    set({ loading: true })
    try {
      const user = await authApi.me()
      set({ user })
    } finally {
      set({ loading: false })
    }
  },
  logout: () => {
    localStorage.removeItem('nexusbi_token')
    set({ token: null, user: null })
  },
}))
