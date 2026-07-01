import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Lock, Palette, RotateCcw, Save, Sparkles } from 'lucide-react'
import * as branding from '../api/branding'
import { useAuthStore } from '../store/authStore'
import { readableTextColor } from '../lib/color'

const DEFAULTS = { app_name: 'NexusBI', primary_color: '#0E9F6E', logo_url: '' }
const HEX = /^#[0-9a-fA-F]{6}$/

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

        {/* Live embed preview */}
        <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
          <div
            className="flex items-center gap-2.5 border-b border-line px-5 py-4"
            style={{ borderTopColor: accent, borderTopWidth: 3 }}
          >
            {form.logo_url && !logoBroken ? (
              <img
                src={form.logo_url}
                alt={form.app_name}
                className="h-7 w-auto"
                onError={() => setLogoBroken(true)}
              />
            ) : (
              <span className="font-display text-lg font-bold text-ink">{form.app_name || 'NexusBI'}</span>
            )}
            <span
              className="ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold"
              style={{ backgroundColor: accent, color: previewText }}
            >
              {t('brandingPage.sampleButton')}
            </span>
          </div>
          <div className="space-y-3 p-5">
            <p className="eyebrow">{t('brandingPage.previewLabel')}</p>
            <div className="h-3 w-2/3 rounded-full bg-line" />
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-xl border border-line bg-surface p-3">
                  <div className="mb-2 h-2 w-12 rounded-full bg-line" />
                  <div className="h-6 w-16 rounded" style={{ backgroundColor: accent, opacity: 0.85 }} />
                </div>
              ))}
            </div>
            <div className="flex h-32 items-end gap-2 rounded-xl border border-line bg-surface p-3">
              {[40, 70, 55, 90, 65, 80].map((h, i) => (
                <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, backgroundColor: accent, opacity: 0.85 }} />
              ))}
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
