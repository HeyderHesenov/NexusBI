import { ArrowRight, Lock, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { GoogleButton } from '../components/auth/GoogleButton'
import { NexusMark } from '../components/brand/NexusMark'
import { AuroraBackground } from '../components/layout/AuroraBackground'
import { getProviders } from '../api/auth'
import { useAuthStore } from '../store/authStore'
import { clearHint, readHint, saveHint } from '../lib/loginHint'
import type { AuthProviders } from '../types'

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint transition focus:border-accent focus:outline-none'

export function LoginPage() {
  const { login, register, googleLogin } = useAuthStore()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [providers, setProviders] = useState<AuthProviders | null>(null)
  const [hint, setHint] = useState(() => readHint())
  const [showHint, setShowHint] = useState(false)

  useEffect(() => {
    getProviders()
      .then(setProviders)
      .catch(() => setProviders({ google_enabled: false, google_client_id: null }))
  }, [])

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setShowHint(false)
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password, fullName)
      saveHint(email, password)
      navigate('/')
    } catch (err: unknown) {
      const fallback =
        mode === 'login' ? 'Email və ya şifrə yanlışdır.' : 'Qeydiyyat alınmadı.'
      const e = err as { response?: { data?: { message?: string; detail?: string } } }
      setError(e.response?.data?.message ?? e.response?.data?.detail ?? fallback)
    } finally {
      setBusy(false)
    }
  }

  const switchMode = () => {
    setError('')
    setShowHint(false)
    setMode(mode === 'login' ? 'register' : 'login')
  }

  const fillFromHint = useCallback(() => {
    if (!hint) return
    setEmail(hint.email)
    setPassword(hint.password)
    setShowHint(false)
  }, [hint])

  const dismissHint = useCallback(() => {
    clearHint()
    setHint(null)
    setShowHint(false)
  }, [])

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

  return (
    <div className="relative grid min-h-screen grid-cols-1 overflow-hidden bg-bg lg:grid-cols-2">
      <AuroraBackground />

      {/* Feature side */}
      <div className="relative z-10 hidden flex-col justify-between border-r border-line/60 p-12 lg:flex">
        <div className="reveal flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface-2">
            <NexusMark size={20} />
          </span>
          <span className="font-display text-lg font-bold tracking-tight text-ink">
            Nexus<span className="text-accent">BI</span>
          </span>
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
        <div className="reveal reveal-d2 w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-card">
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

          <form onSubmit={submit} className="space-y-3" noValidate>
            {mode === 'register' && (
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                name="name"
                autoComplete="name"
                placeholder="Ad Soyad"
                className={field}
              />
            )}
            <div className="relative">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => hint && mode === 'login' && setShowHint(true)}
                onBlur={() => setShowHint(false)}
                onKeyDown={(e) => e.key === 'Escape' && setShowHint(false)}
                name="email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                className={field}
              />
              {mode === 'login' && showHint && hint && (
                <div
                  role="listbox"
                  aria-label="Son giriş təklifi"
                  className="hint-pop absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-card"
                >
                  <p className="border-b border-line/70 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    Son giriş
                  </p>
                  <div className="flex items-center gap-1.5 p-1.5">
                    <button
                      type="button"
                      role="option"
                      aria-selected="true"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        fillFromHint()
                      }}
                      className="flex flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft font-display text-sm font-bold uppercase text-accent">
                        {hint.email.charAt(0) || '?'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {hint.email}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1 text-ink-faint">
                          <Lock size={11} strokeWidth={2} />
                          <span className="font-mono text-xs tracking-[0.25em]">
                            ••••••••
                          </span>
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Təklifi sil"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        dismissHint()
                      }}
                      className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink focus-visible:outline-none"
                    >
                      <X size={16} strokeWidth={2.25} />
                    </button>
                  </div>
                </div>
              )}
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              name="password"
              autoComplete="current-password"
              placeholder="Şifrə"
              className={field}
            />

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-[#D87C6B]/40 bg-[#D87C6B]/10 px-3 py-2 text-sm text-[#E0998A]"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Gözləyin…' : mode === 'login' ? 'Daxil ol' : 'Qeydiyyatdan keç'}
              {!busy && <ArrowRight size={16} strokeWidth={2.5} />}
            </button>
          </form>

          <button
            onClick={switchMode}
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
