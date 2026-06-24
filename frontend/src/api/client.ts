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

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const detail =
      error.response?.data?.message ??
      error.response?.data?.detail ??
      'Naməlum xəta baş verdi.'
    if (status === 401) {
      localStorage.removeItem('nexusbi_token')
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
    } else {
      toast.error(typeof detail === 'string' ? detail : 'Xəta baş verdi.')
    }
    return Promise.reject(error)
  },
)
