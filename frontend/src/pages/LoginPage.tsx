import { ArrowRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { GoogleButton } from '../components/auth/GoogleButton'
import { AuroraBackground } from '../components/layout/AuroraBackground'
import { getProviders } from '../api/auth'
import { useAuthStore } from '../store/authStore'
import type { AuthProviders } from '../types'

export function LoginPage() {
  const { login, register, googleLogin } = useAuthStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [providers, setProviders] = useState<AuthProviders | null>(null)

  useEffect(() => {
    getProviders()
      .then(setProviders)
      .catch(() => setProviders({ google_enabled: false, google_client_id: null }))
  }, [])

  const submit = async () => {
    if (busy) return
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

  const onGoogleCredential = useCallback(
    async (credential: string) => {
      try {
        await googleLogin(credential)
        navigate('/')
      } catch {
        /* interceptor toast */
      }
    },
    [googleLogin, navigate],
  )

  const field =
    'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint transition focus:border-accent focus:outline-none'

  return (
    <div className="relative grid min-h-screen grid-cols-1 overflow-hidden bg-bg lg:grid-cols-2">
      <AuroraBackground />

      {/* Feature side */}
      <div className="relative z-10 hidden flex-col justify-between border-r border-line/60 p-12 lg:flex">
        <div className="reveal flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent">
            <span className="h-2.5 w-2.5 rounded-full bg-bg" />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-ink">NexusBI</span>
        </div>

        <div className="max-w-md">
          <p className="reveal reveal-d1 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
            words → SQL → plot
          </p>
          <h1 className="mt-4 font-display text-5xl font-bold leading-[1.04] text-ink">
            <span className="reveal reveal-d2 block">Sual ver.</span>
            <span className="reveal reveal-d3 block">Cavabı gör.</span>
          </h1>
          <p className="reveal reveal-d4 mt-5 text-ink-soft">
            SQL bilmədən datanla danış. NexusBI sualını sorğuya çevirir, icra edir
            və ən uyğun chart-la cavablandırır.
          </p>
        </div>

        <p className="reveal reveal-d5 font-mono text-xs text-ink-faint">
          demo · sales · customers · products
        </p>
      </div>

      {/* Form side */}
      <div className="relative z-10 flex items-center justify-center px-6 py-12">
        <div className="reveal reveal-d2 w-full max-w-sm rounded-2xl border border-line bg-surface/80 p-8 shadow-card backdrop-blur">
          <p className="eyebrow">{mode === 'login' ? 'Yenidən xoş gəldin' : 'Başla'}</p>
          <h2 className="mt-1 font-display text-3xl font-bold text-ink">
            {mode === 'login' ? 'Daxil ol' : 'Hesab yarat'}
          </h2>

          {/* Google */}
          <div className="mt-6">
            {providers?.google_enabled && providers.google_client_id ? (
              <GoogleButton
                clientId={providers.google_client_id}
                onCredential={onGoogleCredential}
              />
            ) : (
              <button
                onClick={() =>
                  toast('Google girişi hələ konfiqurasiya olunmayıb.', { icon: 'ℹ️' })
                }
                className="flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface-2 py-2.5 text-sm font-medium text-ink transition hover:border-ink-faint"
              >
                <GoogleGlyph /> Google ilə davam et
              </button>
            )}
          </div>

          <div className="my-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              və ya email
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="space-y-3">
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
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
          >
            {mode === 'login' ? 'Daxil ol' : 'Qeydiyyatdan keç'}
            <ArrowRight size={16} strokeWidth={2.5} />
          </button>

          <button
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            className="mt-4 w-full text-sm text-ink-soft transition hover:text-ink"
          >
            {mode === 'login' ? 'Hesabın yoxdur? Qeydiyyat' : 'Hesabın var? Daxil ol'}
          </button>
        </div>
      </div>
    </div>
  )
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.5 29.6 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 43.5c5.5 0 10.3-1.9 13.9-5.1l-6.4-5.4C29.4 34.6 26.8 35.5 24 35.5c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39 16.2 43.5 24 43.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.4 5.4C40 36.4 43.5 31 43.5 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  )
}
