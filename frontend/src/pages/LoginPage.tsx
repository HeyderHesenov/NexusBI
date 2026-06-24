import { CornerDownLeft } from 'lucide-react'
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

  const field =
    'w-full rounded-xl border border-grid bg-paper px-4 py-2.5 text-ink placeholder:text-muted/70 focus:border-brand focus:bg-panel focus:outline-none'

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Brand thesis panel */}
      <div className="plot-grid relative hidden flex-col justify-between bg-brand p-12 text-white lg:flex">
        <span className="font-display text-2xl font-bold">
          Nexus<span className="text-signal">BI</span>
        </span>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/45">
            words → SQL → plot
          </p>
          <h1 className="mt-4 font-display text-5xl font-bold leading-[1.05]">
            Sual ver.
            <br />
            Cavabı gör.
          </h1>
          <p className="mt-5 max-w-sm text-white/65">
            SQL bilmədən datanla danış. NexusBI sualını sorğuya çevirir, icra edir
            və ən uyğun chart-la cavablandırır.
          </p>
        </div>
        <p className="font-mono text-xs text-white/40">demo · sales · customers · products</p>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center bg-paper px-6 py-12">
        <div className="w-full max-w-sm">
          <p className="eyebrow">{mode === 'login' ? 'Yenidən xoş gəldin' : 'Başla'}</p>
          <h2 className="mt-1 font-display text-3xl font-bold text-ink">
            {mode === 'login' ? 'Daxil ol' : 'Hesab yarat'}
          </h2>

          <div className="mt-7 space-y-3">
            {mode === 'register' && (
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Ad Soyad"
                className={field}
              />
            )}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Email"
              className={field}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Şifrə"
              className={field}
            />
          </div>

          <button
            onClick={submit}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-signal py-3 font-semibold text-brand shadow-key transition active:translate-y-0.5 active:shadow-none disabled:opacity-50"
          >
            {mode === 'login' ? 'Daxil ol' : 'Qeydiyyatdan keç'}
            <CornerDownLeft size={16} strokeWidth={2.5} />
          </button>

          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="mt-4 w-full text-sm text-muted transition hover:text-ink"
          >
            {mode === 'login' ? 'Hesabın yoxdur? Qeydiyyat' : 'Hesabın var? Daxil ol'}
          </button>
        </div>
      </div>
    </div>
  )
}
