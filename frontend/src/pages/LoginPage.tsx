import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export function LoginPage() {
  const { login, register } = useAuthStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password, fullName)
      navigate('/')
    } catch {
      /* toast handled by interceptor */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <div className="w-96 rounded-2xl border border-slate-800 bg-slate-900 p-8">
        <h1 className="mb-1 text-2xl font-bold text-brand">NexusBI</h1>
        <p className="mb-6 text-sm text-slate-400">
          {mode === 'login' ? 'Daxil ol' : 'Qeydiyyat'}
        </p>
        {mode === 'register' && (
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ad Soyad"
            className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-brand focus:outline-none"
          />
        )}
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-brand focus:outline-none"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Şifrə"
          className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-brand focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="w-full rounded-lg bg-brand py-2 font-medium text-slate-900 disabled:opacity-50"
        >
          {mode === 'login' ? 'Daxil ol' : 'Qeydiyyatdan keç'}
        </button>
        <button
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          className="mt-3 w-full text-sm text-slate-400 hover:text-brand"
        >
          {mode === 'login' ? 'Hesabın yoxdur? Qeydiyyat' : 'Hesabın var? Daxil ol'}
        </button>
      </div>
    </div>
  )
}
