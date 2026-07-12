import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, Check, Lock, Palette, RotateCcw, Save, Sparkles } from 'lucide-react'
import * as branding from '../api/branding'
import { useAuthStore } from '../store/authStore'
import { useThemeStore } from '../store/themeStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonRows } from '../components/ui/Skeleton'
import { Field, FIELD } from '../components/ui/form'
import { useMounted } from '../components/twin/chartkit'
import { useCountUp } from '../hooks/useCountUp'
import { contrastRatio, deriveAccentVariants, hexToTriplet, readableTextColor } from '../lib/color'

const DEFAULTS = { app_name: 'NexusBI', primary_color: '#0E9F6E', logo_url: '' }
const HEX = /^#[0-9a-fA-F]{6}$/
const DANGER = '#D87C6B'

// Curated brand presets — one click instead of hunting hex codes. All pass the
// 3:1 both-themes contrast check below (no preset triggers the warning chip).
const PRESETS = ['#0E9F6E', '#2563EB', '#6366F1', '#8B5CF6', '#E11D48', '#D97706', '#0D9488', '#64748B']

// The upgrade CTA must stay an <a> (role=link → /pricing), so it can't be a
// <Button> (renders a <button>). Mirror the primary-button styling here.
const PRIMARY_LINK =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'

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
  const isDark = useThemeStore((s) => s.mode === 'dark')
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
        <PageHeader eyebrow={t('brandingPage.eyebrow')} title={t('brandingPage.title')} />
        <EmptyState
          size="lg"
          icon={
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Lock size={22} />
            </span>
          }
          title={t('brandingPage.upsellHeading')}
          description={t('brandingPage.upsellBody')}
          action={
            <Link to="/pricing" className={PRIMARY_LINK}>
              <Sparkles size={15} /> {t('brandingPage.upgradeCta')}
            </Link>
          }
        />
      </div>
    )
  }

  const previewText = HEX.test(form.primary_color) ? readableTextColor(form.primary_color) : '#FFFFFF'
  const accent = HEX.test(form.primary_color) ? form.primary_color : DEFAULTS.primary_color
  // The accent is used as text/fills on both light (#FFFFFF) and dark (#1F1E1D)
  // surfaces — WCAG AA for UI components needs ≥3:1 against each, otherwise the
  // brand color disappears in one of the themes (e.g. yellow on white).
  const aaOk = contrastRatio(accent, '#FFFFFF') >= 3 && contrastRatio(accent, '#1F1E1D') >= 3

  // Scope the brand accent to the preview subtree ONLY (not <html>), so the
  // real `bg-accent`/`text-accent` utilities inside render in the brand color —
  // exactly how the live embed re-skins itself — without touching the owner's
  // own console. Charts use a fixed JS palette (charts/theme.ts) and can't read
  // this, so the preview is a faithful chrome-level re-skin, not a Recharts mock.
  const triplet = hexToTriplet(accent)
  const variants = deriveAccentVariants(accent, isDark)
  const previewStyle = {
    ...(triplet ? { '--accent': triplet } : {}),
    ...(variants ? { '--accent-press': variants.press, '--accent-soft': variants.soft } : {}),
  } as CSSProperties

  const errBorder = (bad: boolean) => (bad ? '!border-[#D87C6B]' : '')

  return (
    <div className="w-full">
      <PageHeader
        eyebrow={t('brandingPage.eyebrow')}
        title={t('brandingPage.title')}
        subtitle={t('brandingPage.subtitle')}
        actions={
          canReset ? (
            <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => setForm(DEFAULTS)}>
              {t('brandingPage.resetDefault')}
            </Button>
          ) : undefined
        }
      />

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
          className="reveal space-y-5 rounded-2xl border border-line bg-surface p-5 shadow-card"
        >
          {loading ? (
            <SkeletonRows rows={3} rowClassName="h-16" />
          ) : (
            <>
              <section className="space-y-4">
                <p className="eyebrow">{t('brandingPage.sectionIdentity')}</p>
                <Field id={ids.name} label={t('brandingPage.labelAppName')} error={errors.app_name ? t(errors.app_name) : undefined}>
                  <input
                    id={ids.name}
                    value={form.app_name}
                    onChange={(e) => set('app_name', e.target.value)}
                    maxLength={120}
                    aria-invalid={!!errors.app_name}
                    aria-describedby={errors.app_name ? `${ids.name}-err` : undefined}
                    className={`${FIELD} ${errBorder(!!errors.app_name)}`}
                  />
                </Field>

                <Field
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
                    className={`${FIELD} ${errBorder(!!errors.logo_url)}`}
                  />
                </Field>
              </section>

              <div className="border-t border-line" />

              <section className="space-y-3">
                <p className="eyebrow">{t('brandingPage.sectionColor')}</p>
                <Field id={ids.color} label={t('brandingPage.labelPrimaryColor')} error={errors.primary_color ? t(errors.primary_color) : undefined}>
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
                      className={`${FIELD} font-mono ${errBorder(!!errors.primary_color)}`}
                    />
                  </div>
                </Field>

                <div className="flex flex-wrap items-center gap-2">
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
                          className={`h-6 w-6 rounded-full border border-line ring-offset-2 ring-offset-surface transition ${
                            selected
                              ? 'ring-2 ring-accent'
                              : 'hover:ring-2 hover:ring-line-strong'
                          }`}
                          style={{ backgroundColor: p }}
                        />
                      )
                    })}
                  </span>
                  {aaOk ? (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                      <Check size={12} /> {t('brandingPage.contrastOk')}
                    </span>
                  ) : (
                    <span
                      className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: 'rgba(216, 124, 107, 0.15)', color: DANGER }}
                    >
                      <AlertTriangle size={12} /> {t('brandingPage.contrastLow')}
                    </span>
                  )}
                </div>
              </section>

              <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
                <span className="flex items-center gap-2 text-xs text-ink-faint">
                  <Palette size={13} /> {t('brandingPage.appliesNote')}
                </span>
                <Button type="submit" loading={busy} disabled={!dirty || !valid} icon={<Save size={15} />}>
                  {busy ? t('brandingPage.saving') : t('brandingPage.save')}
                </Button>
              </div>
            </>
          )}
        </form>

        {/* Live preview — a miniature of the app wearing the brand accent. */}
        <BrandPreview
          appName={form.app_name}
          logoUrl={form.logo_url}
          logoBroken={logoBroken}
          onLogoError={() => setLogoBroken(true)}
          accent={accent}
          previewText={previewText}
          style={previewStyle}
        />
      </div>
    </div>
  )
}

const PREVIEW_BARS = [42, 60, 48, 74, 64, 88, 78, 96]
const PREVIEW_SPARK = [6, 9, 7, 12, 10, 15, 13, 18]
const PREVIEW_STATS = ['1 284', '18.6%']

// The sparkline path is a fixed decorative shape — compute it once at module load
// (60×22 viewBox), not on every count-up frame.
const SPARK_MIN = Math.min(...PREVIEW_SPARK)
const SPARK_MAX = Math.max(...PREVIEW_SPARK)
const SPARK_PATH = PREVIEW_SPARK.map((v, i) => {
  const x = (i / (PREVIEW_SPARK.length - 1)) * 60
  const y = 22 - ((v - SPARK_MIN) / (SPARK_MAX - SPARK_MIN || 1)) * 22
  return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
}).join(' ')

function BrandPreview({
  appName,
  logoUrl,
  logoBroken,
  onLogoError,
  accent,
  previewText,
  style,
}: {
  appName: string
  logoUrl: string
  logoBroken: boolean
  onLogoError: () => void
  accent: string
  previewText: string
  style: CSSProperties
}) {
  const { t } = useTranslation()
  const mounted = useMounted()
  const kpi = useCountUp(42.8, 900)

  return (
    <div style={style} className="reveal reveal-d1 overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-card">
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-full bg-line" />
          ))}
        </span>
        <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-surface px-3 py-1 font-mono text-[10px] text-ink-faint">
          app.{(appName || 'nexusbi').toLowerCase().replace(/\s+/g, '')}.io
        </span>
        <span className="eyebrow shrink-0 text-[9px]">{t('brandingPage.previewLabel')}</span>
      </div>

      {/* Topbar */}
      <div className="flex items-center gap-2.5 border-b border-line bg-surface px-4 py-3">
        {logoUrl && !logoBroken ? (
          <img src={logoUrl} alt={appName} className="h-6 w-auto" onError={onLogoError} />
        ) : (
          <span className="font-display text-base font-bold text-ink">{appName || 'NexusBI'}</span>
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
        <div className="hidden w-28 shrink-0 space-y-1.5 border-r border-line bg-surface p-3 sm:block">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${i === 0 ? 'bg-accent-soft' : ''}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'bg-accent' : 'bg-line'}`} />
              <span className={`h-1.5 flex-1 rounded-full ${i === 0 ? 'bg-accent/70' : 'bg-line'}`} />
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 space-y-3 p-4">
          <div className="grid grid-cols-3 gap-3">
            {/* Rich KPI tile with count-up + brand sparkline */}
            <div className="plot-grid rounded-xl border border-line bg-surface p-3">
              <p className="eyebrow text-[9px]">{t('brandingPage.previewKpiLabel')}</p>
              <div className="mt-1 flex items-end justify-between gap-1">
                <span className="font-display text-lg font-bold tabular-nums text-accent">{kpi.toFixed(1)}k</span>
                <svg width={60} height={22} className="overflow-visible" aria-hidden="true">
                  <path d={SPARK_PATH} fill="none" stroke="rgb(var(--accent))" strokeWidth={1.6} strokeLinecap="round" />
                </svg>
              </div>
              <span className="mt-1 inline-flex rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                +12.4%
              </span>
            </div>
            {PREVIEW_STATS.map((v) => (
              <div key={v} className="rounded-xl border border-line bg-surface p-3">
                <div className="mb-1.5 h-1.5 w-10 rounded-full bg-line" />
                <p className="font-display text-lg font-bold text-accent">{v}</p>
              </div>
            ))}
          </div>

          <div className="flex h-24 items-end gap-1.5 rounded-xl border border-line bg-surface p-3">
            {PREVIEW_BARS.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-accent"
                style={{
                  height: `${h}%`,
                  opacity: 0.9,
                  transformOrigin: 'bottom',
                  transform: mounted ? 'scaleY(1)' : 'scaleY(0)',
                  transition: `transform .5s cubic-bezier(.22,.61,.36,1) ${i * 45}ms`,
                }}
              />
            ))}
          </div>

          <div className="space-y-1.5 rounded-xl border border-line bg-surface p-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="h-1.5 flex-1 rounded-full bg-line" />
                <span className="h-3.5 w-10 shrink-0 rounded-full bg-accent-soft" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
