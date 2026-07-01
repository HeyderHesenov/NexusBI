import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Lock, Palette, RotateCcw, Save, Sparkles } from 'lucide-react'
import * as branding from '../api/branding'
import { useAuthStore } from '../store/authStore'
import { contrastRatio, readableTextColor } from '../lib/color'

const DEFAULTS = { app_name: 'NexusBI', primary_color: '#0E9F6E', logo_url: '' }
const HEX = /^#[0-9a-fA-F]{6}$/

// Curated brand presets — one click instead of hunting hex codes. All pass the
// 3:1 both-themes contrast check below (no preset triggers the warning chip).
const PRESETS = ['#0E9F6E', '#2563EB', '#6366F1', '#8B5CF6', '#E11D48', '#D97706', '#0D9488', '#64748B']

const field =
  'w-full rounded-xl border bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:outline-none'

type Form = { app_name: string; primary_color: string; logo_url: string }
type Errors = Partial<Record<keyof Form, string>>

function validate(f: Form): Errors {
  const e: Errors = {}
  if (f.app_name.length > 120) e.app_name = 'brandingPage.errNameLength'
  else if (/[<>]/.test(f.app_name)) e.app_name = 'brandingPage.errNameAngle'
  if (!HEX.test(f.primary_color)) e.primary_color = 'brandingPage.errColorFormat'
  if (f.logo_url) {
    if (f.logo_url.length > 2000) e.logo_url = 'brandingPage.errLogoLong'
    // Case-sensitive to mirror the backend's `startswith(("http://","https://"))`.
    else if (!/^https?:\/\//.test(f.logo_url)) e.logo_url = 'brandingPage.errLogoScheme'
  }
  return e
}

export function BrandingPage() {
  const { t } = useTranslation()
  const whiteLabel = useAuthStore((s) => s.user?.white_label)
  const ids = { name: useId(), color: useId(), logo: useId() }

  const [form, setForm] = useState<Form>(DEFAULTS)
  const [saved, setSaved] = useState<Form | null>(null) // last persisted snapshot
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logoBroken, setLogoBroken] = useState(false)

  useEffect(() => {
    let alive = true
    branding
      .getBrand()
      .then((b) => {
        if (!alive) return
        const next = { app_name: b.app_name, primary_color: b.primary_color, logo_url: b.logo_url }
        setForm(next)
        setSaved(next)
      })
      .catch(() => alive && setLoadError(true))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const errors = useMemo(() => validate(form), [form])
  const dirty = saved != null && JSON.stringify(form) !== JSON.stringify(saved)
  const canReset = JSON.stringify(form) !== JSON.stringify(DEFAULTS)
  const valid = Object.keys(errors).length === 0
  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (k === 'logo_url') setLogoBroken(false)
  }

  const save = async () => {
    if (!dirty || !valid) return
    setBusy(true)
    try {
      const b = await branding.putBrand(form)
      const next = { app_name: b.app_name, primary_color: b.primary_color, logo_url: b.logo_url }
      setForm(next)
      setSaved(next)
      toast.success(t('brandingPage.savedToast'))
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  // ─── Tier gate ─── (server-enforced; this only renders the upsell when we know
  // the user lacks white-label — `undefined` means the user is still loading.)
  if (whiteLabel === false) {
    return (
      <div className="w-full">
        <header className="mb-6">
          <p className="eyebrow">White-label</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('brandingPage.title')}</h1>
        </header>
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Lock size={22} />
            </span>
            <h2 className="mt-4 font-display text-xl font-bold text-ink">{t('brandingPage.upsellHeading')}</h2>
            <p className="mt-2 text-sm text-ink-soft">
              {t('brandingPage.upsellBody')}
            </p>
            <Link
              to="/pricing"
              className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
            >
              <Sparkles size={15} /> {t('brandingPage.upgradeCta')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const previewText = HEX.test(form.primary_color) ? readableTextColor(form.primary_color) : '#FFFFFF'
  const accent = HEX.test(form.primary_color) ? form.primary_color : DEFAULTS.primary_color
  // The accent is used as text/fills on both light (#FFFFFF) and dark (#1F1E1D)
  // surfaces — WCAG AA for UI components needs ≥3:1 against each, otherwise the
  // brand color disappears in one of the themes (e.g. yellow on white).
  const aaOk = contrastRatio(accent, '#FFFFFF') >= 3 && contrastRatio(accent, '#1F1E1D') >= 3

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">White-label</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('brandingPage.title')}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {t('brandingPage.subtitle')}
          </p>
        </div>
        {canReset && (
          <button
            onClick={() => setForm(DEFAULTS)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            <RotateCcw size={14} /> {t('brandingPage.resetDefault')}
          </button>
        )}
      </header>

      {loadError && (
        <p className="mb-4 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm text-ink-soft">
          {t('brandingPage.loadError')}
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
        {/* Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          className="space-y-4 rounded-2xl border border-line bg-surface p-5"
        >
          {loading ? (
            <div className="space-y-4" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-24 rounded bg-surface-2" />
                  <div className="h-10 w-full rounded-xl bg-surface-2" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <Fieldset id={ids.name} label={t('brandingPage.labelAppName')} error={errors.app_name ? t(errors.app_name) : undefined}>
                <input
                  id={ids.name}
                  value={form.app_name}
                  onChange={(e) => set('app_name', e.target.value)}
                  maxLength={120}
                  aria-invalid={!!errors.app_name}
                  aria-describedby={errors.app_name ? `${ids.name}-err` : undefined}
                  className={`${field} ${errors.app_name ? 'border-[#D87C6B]' : 'border-line focus:border-accent'}`}
                />
              </Fieldset>

              <Fieldset id={ids.color} label={t('brandingPage.labelPrimaryColor')} error={errors.primary_color ? t(errors.primary_color) : undefined}>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    aria-label={t('brandingPage.colorPickerLabel')}
                    value={HEX.test(form.primary_color) ? form.primary_color : DEFAULTS.primary_color}
                    onChange={(e) => set('primary_color', e.target.value)}
                    className="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-line bg-surface-2"
                  />
                  <input
                    id={ids.color}
                    value={form.primary_color}
                    onChange={(e) => set('primary_color', e.target.value)}
                    spellCheck={false}
                    aria-invalid={!!errors.primary_color}
                    aria-describedby={errors.primary_color ? `${ids.color}-err` : undefined}
                    className={`${field} font-mono ${errors.primary_color ? 'border-[#D87C6B]' : 'border-line focus:border-accent'}`}
                  />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5" role="group" aria-label={t('brandingPage.presetsLabel')}>
                    {PRESETS.map((p) => {
                      const selected = form.primary_color.toLowerCase() === p.toLowerCase()
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => set('primary_color', p)}
                          aria-label={p}
                          aria-pressed={selected}
                          title={p}
                          className={`h-6 w-6 rounded-full border border-line transition ${
                            selected
                              ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
                              : 'hover:scale-110'
                          }`}
                          style={{ backgroundColor: p }}
                        />
                      )
                    })}
                  </span>
                  {aaOk ? (
                    <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                      ✓ {t('brandingPage.contrastOk')}
                    </span>
                  ) : (
                    <span
                      className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: 'rgba(216, 124, 107, 0.15)', color: '#D87C6B' }}
                    >
                      ⚠ {t('brandingPage.contrastLow')}
                    </span>
                  )}
                </div>
              </Fieldset>

              <Fieldset
                id={ids.logo}
                label={t('brandingPage.labelLogoUrl')}
                error={errors.logo_url ? t(errors.logo_url) : undefined}
                hint={t('brandingPage.hintLogoUrl')}
              >
                <input
                  id={ids.logo}
                  type="url"
                  value={form.logo_url}
                  onChange={(e) => set('logo_url', e.target.value)}
                  placeholder="https://…/logo.svg"
                  aria-invalid={!!errors.logo_url}
                  aria-describedby={errors.logo_url ? `${ids.logo}-err` : `${ids.logo}-hint`}
                  className={`${field} ${errors.logo_url ? 'border-[#D87C6B]' : 'border-line focus:border-accent'}`}
                />
              </Fieldset>

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="flex items-center gap-2 text-xs text-ink-faint">
                  <Palette size={13} /> {t('brandingPage.appliesNote')}
                </span>
                <button
                  type="submit"
                  disabled={busy || !dirty || !valid}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
                >
                  <Save size={15} /> {busy ? t('brandingPage.saving') : t('brandingPage.save')}
                </button>
              </div>
            </>
          )}
        </form>

        {/* Live preview: a miniature of the app wearing the brand */}
        <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
          {/* Window chrome */}
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
            <span className="flex gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-2.5 w-2.5 rounded-full bg-line" />
              ))}
            </span>
            <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-surface px-3 py-1 font-mono text-[10px] text-ink-faint">
              app.{(form.app_name || 'nexusbi').toLowerCase().replace(/\s+/g, '')}.io
            </span>
            <span className="eyebrow shrink-0 text-[9px]">{t('brandingPage.previewLabel')}</span>
          </div>
          {/* Topbar */}
          <div className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
            {form.logo_url && !logoBroken ? (
              <img
                src={form.logo_url}
                alt={form.app_name}
                className="h-6 w-auto"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <span className="font-display text-base font-bold text-ink">
                {form.app_name || 'NexusBI'}
              </span>
            )}
            <span
              className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold"
              style={{ backgroundColor: accent, color: previewText }}
            >
              {t('brandingPage.sampleButton')}
            </span>
          </div>
          {/* Sidebar + content */}
          <div className="flex">
            <div className="hidden w-32 shrink-0 space-y-1.5 border-r border-line bg-surface p-3 sm:block">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                  style={i === 0 ? { backgroundColor: `${accent}1F` } : undefined}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: i === 0 ? accent : 'rgb(var(--line))' }}
                  />
                  <span
                    className="h-1.5 flex-1 rounded-full"
                    style={{
                      backgroundColor: i === 0 ? accent : 'rgb(var(--line))',
                      opacity: i === 0 ? 0.7 : 1,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="min-w-0 flex-1 space-y-3 p-4">
              <div className="grid grid-cols-3 gap-3">
                {['42.8k', '+12.4%', '1 284'].map((v) => (
                  <div key={v} className="rounded-xl border border-line bg-surface p-3">
                    <div className="mb-1.5 h-1.5 w-10 rounded-full bg-line" />
                    <p className="font-display text-lg font-bold" style={{ color: accent }}>
                      {v}
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex h-28 items-end gap-1.5 rounded-xl border border-line bg-surface p-3">
                {[35, 55, 45, 70, 60, 85, 75, 95].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t"
                    style={{ height: `${h}%`, backgroundColor: accent, opacity: 0.85 }}
                  />
                ))}
              </div>
              <div className="space-y-1.5 rounded-xl border border-line bg-surface p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 rounded-full bg-line" />
                    <span
                      className="h-3.5 w-10 shrink-0 rounded-full"
                      style={{ backgroundColor: `${accent}1F` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Fieldset({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="eyebrow mb-1 block">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-[#D87C6B]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
