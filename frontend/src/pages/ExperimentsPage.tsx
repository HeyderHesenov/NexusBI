import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { FlaskConical, Percent, Play, Plus, Sigma, Trash2, Trophy } from 'lucide-react'
import { useExperimentStore } from '../store/experimentStore'
import { ModalShell } from '../components/ui/ModalShell'
import type { Experiment, ExperimentKind } from '../types'

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

const num = (v: string) => (v === '' ? NaN : Number(v))

export function ExperimentsPage() {
  const { t } = useTranslation()
  const { items, load, add, analyze, remove } = useExperimentStore()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <div className="w-full">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{t('experimentsPage.eyebrow')}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
            {t('experimentsPage.title')}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">{t('experimentsPage.subtitle')}</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
        >
          <Plus size={15} /> {t('experimentsPage.newExperiment')}
        </button>
      </header>

      {items.length === 0 ? (
        <div className="plot-grid grid min-h-[55vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <div>
            <FlaskConical size={22} className="mx-auto text-ink-faint" />
            <p className="mt-2 font-display text-lg text-ink">{t('experimentsPage.emptyTitle')}</p>
            <p className="mt-1 text-sm text-ink-soft">{t('experimentsPage.emptyDesc')}</p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((e) => (
            <ExperimentCard
              key={e.id}
              exp={e}
              onAnalyze={() => analyze(e.id)}
              onRemove={() => remove(e.id)}
            />
          ))}
        </ul>
      )}

      {open && <CreateModal onClose={() => setOpen(false)} onCreate={add} />}
    </div>
  )
}

function ExperimentCard({
  exp,
  onAnalyze,
  onRemove,
}: {
  exp: Experiment
  onAnalyze: () => Promise<void>
  onRemove: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const r = exp.result
  const run = async () => {
    setBusy(true)
    try {
      await onAnalyze()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">{exp.name}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
            {exp.kind === 'conversion'
              ? t('experimentsPage.conversion')
              : t('experimentsPage.mean')}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-60"
          >
            <Play size={13} />{' '}
            {busy ? t('experimentsPage.analyzing') : t('experimentsPage.analyze')}
          </button>
          <button
            onClick={onRemove}
            aria-label={t('experimentsPage.delete')}
            className="rounded-lg border border-line p-1.5 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {r && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            {r.winner && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                <Trophy size={12} /> {r.winner}
              </span>
            )}
            <p className={`text-sm font-medium ${r.significant ? 'text-ink' : 'text-ink-soft'}`}>
              {r.verdict}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['a', 'b'] as const).map((k) => {
              const label = k === 'a' ? exp.a_label : exp.b_label
              const val = r.metric[k]
              const isWinner = r.winner === label
              return (
                <div key={k} className="rounded-xl border border-line bg-surface-2 p-3">
                  <p className="text-xs text-ink-soft">{label}</p>
                  <p
                    className={`font-display text-xl font-bold ${isWinner ? 'text-accent' : 'text-ink'}`}
                  >
                    {val}
                    {r.metric.unit}
                  </p>
                </div>
              )
            })}
          </div>
          <p className="font-mono text-xs text-ink-faint">
            p={r.p_value}
            {r.lift_pct != null ? ` · lift ${r.lift_pct}%` : ''}
            {' · '}95% CI [{r.ci_low}, {r.ci_high}]
          </p>
        </div>
      )}
    </li>
  )
}

// Variant B color: dusty blue from the chart SERIES palette (A stays emerald).
const B_COLOR = '#7C9CC4'
const DANGER = '#D87C6B'

const PLACEHOLDERS: Record<string, string> = {
  n: '1000',
  conversions: '124',
  mean: '42.5',
  sd: '5.0',
}

function CreateModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (p: import('../types').ExperimentCreate) => Promise<void>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ExperimentKind>('conversion')
  const [a, setA] = useState<Record<string, string>>({})
  const [b, setB] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const fields = kind === 'conversion' ? ['n', 'conversions'] : ['n', 'mean', 'sd']
  const labels: Record<string, string> = {
    n: t('experimentsPage.fieldN'),
    conversions: t('experimentsPage.conversion'),
    mean: t('experimentsPage.mean'),
    sd: t('experimentsPage.fieldSd'),
  }

  // Inline errors only for filled-in fields; empty fields just gate `valid`.
  const fieldError = (o: Record<string, string>, f: string): string | null => {
    const v = o[f] ?? ''
    if (v === '') return null
    const x = Number(v)
    if (Number.isNaN(x)) return null
    if (f === 'n' && x < 1) return t('experimentsPage.errN')
    // A mean can legitimately be negative (profit delta, temperature) —
    // negativity is only invalid for counts and spread.
    if (f !== 'mean' && x < 0) return t('experimentsPage.errNegative')
    if (f === 'conversions') {
      const n = num(o.n ?? '')
      if (!Number.isNaN(n) && x > n) return t('experimentsPage.errConversions')
    }
    return null
  }
  const hasErrors = [a, b].some((o) => fields.some((f) => fieldError(o, f) !== null))
  const complete = fields.every(
    (f) => !Number.isNaN(num(a[f] ?? '')) && !Number.isNaN(num(b[f] ?? '')),
  )
  const valid = name.trim() !== '' && complete && !hasErrors

  // Live preview: each variant's rate (conversion) or mean, plus the B-vs-A delta.
  const variantValue = (o: Record<string, string>): number | null => {
    if (kind === 'conversion') {
      const n = num(o.n ?? '')
      const c = num(o.conversions ?? '')
      return n > 0 && c >= 0 && c <= n ? (c / n) * 100 : null
    }
    const m = num(o.mean ?? '')
    return Number.isNaN(m) ? null : m
  }
  const aVal = variantValue(a)
  const bVal = variantValue(b)
  const fmt = (v: number) => (kind === 'conversion' ? `${v.toFixed(1)}%` : `${v}`)
  const delta =
    aVal != null && bVal != null && aVal !== 0 ? ((bVal - aVal) / Math.abs(aVal)) * 100 : null

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    const toNums = (o: Record<string, string>) =>
      Object.fromEntries(fields.map((f) => [f, num(o[f])]))
    try {
      await onCreate({
        name: name.trim(),
        kind,
        data: { a: toNums(a), b: toNums(b) },
      })
      onClose()
    } catch {
      toast.error(t('experimentsPage.createError'))
    } finally {
      setBusy(false)
    }
  }

  const kindCards = [
    {
      key: 'conversion' as const,
      Icon: Percent,
      title: t('experimentsPage.conversionRate'),
      desc: t('experimentsPage.kindConversionDesc'),
    },
    {
      key: 'mean' as const,
      Icon: Sigma,
      title: t('experimentsPage.meanQuantity'),
      desc: t('experimentsPage.kindMeanDesc'),
    },
  ]

  return (
    <ModalShell
      wide
      open
      onClose={onClose}
      title={t('experimentsPage.modalTitle')}
      subtitle={t('experimentsPage.modalSubtitle')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="space-y-6 p-6"
      >
        <div className="gap-8 md:grid md:grid-cols-2">
          {/* Left column: what the experiment is */}
          <div className="space-y-6">
            <div>
              <label htmlFor="exp-name" className="eyebrow mb-1 block">
                {t('experimentsPage.nameLabel')}
              </label>
              <input
                id="exp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={field}
                placeholder={t('experimentsPage.namePlaceholder')}
              />
            </div>

            <div>
              <p className="eyebrow mb-1.5" id="exp-kind-label">
                {t('experimentsPage.metricType')}
              </p>
              <div
                role="radiogroup"
                aria-labelledby="exp-kind-label"
                aria-orientation="vertical"
                className="grid gap-2"
              >
                {kindCards.map(({ key, Icon, title, desc }) => {
                  const selected = kind === key
                  return (
                    <button
                      key={key}
                      id={`exp-kind-${key}`}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setKind(key)}
                      onKeyDown={(e) => {
                        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                          e.preventDefault()
                          const next = key === 'conversion' ? 'mean' : 'conversion'
                          setKind(next)
                          document.getElementById(`exp-kind-${next}`)?.focus()
                        }
                      }}
                      className={`rounded-xl border p-3 text-left transition ${
                        selected
                          ? 'border-accent bg-accent-soft ring-1 ring-accent'
                          : 'border-line hover:border-ink-faint'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon size={15} className={selected ? 'text-accent' : 'text-ink-faint'} />
                        <span
                          className={`text-sm font-semibold ${selected ? 'text-accent' : 'text-ink'}`}
                        >
                          {title}
                        </span>
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-ink-soft">
                        {desc}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right column: the two variants, separated by a "vs" divider */}
          <div className="mt-6 flex flex-col md:mt-0">
            {(['a', 'b'] as const).map((variant) => {
              const state = variant === 'a' ? a : b
              const setState = variant === 'a' ? setA : setB
              const isA = variant === 'a'
              return (
                <Fragment key={variant}>
                  {!isA && (
                    <div
                      aria-hidden="true"
                      className="relative flex items-center justify-center py-2.5"
                    >
                      <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
                      <span className="relative grid h-7 w-7 place-items-center rounded-full border border-line bg-surface font-mono text-[10px] font-semibold text-ink-faint">
                        vs
                      </span>
                    </div>
                  )}
                  <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
                    <p className="flex items-center gap-2 text-xs font-semibold text-ink">
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-bold ${
                          isA ? 'bg-accent-soft text-accent' : ''
                        }`}
                        style={
                          isA
                            ? undefined
                            : {
                                backgroundColor: 'rgba(124, 156, 196, 0.16)',
                                color: B_COLOR,
                              }
                        }
                      >
                        {isA ? 'A' : 'B'}
                      </span>
                      {isA ? t('experimentsPage.variantA') : t('experimentsPage.variantB')}
                    </p>
                    <div
                      className={`grid gap-3 ${fields.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}
                    >
                      {fields.map((f) => {
                        const err = fieldError(state, f)
                        const id = `exp-${variant}-${f}`
                        return (
                          <div key={f}>
                            <label htmlFor={id} className="mb-1 block text-[11px] text-ink-soft">
                              {labels[f]}
                            </label>
                            <input
                              id={id}
                              type="number"
                              step="any"
                              inputMode="decimal"
                              placeholder={PLACEHOLDERS[f]}
                              value={state[f] ?? ''}
                              onChange={(e) => setState((s) => ({ ...s, [f]: e.target.value }))}
                              aria-invalid={err !== null}
                              aria-describedby={err ? `${id}-err` : undefined}
                              className={field}
                              style={err ? { borderColor: DANGER } : undefined}
                            />
                            {err && (
                              <p
                                id={`${id}-err`}
                                className="mt-1 text-[11px]"
                                style={{ color: DANGER }}
                              >
                                {err}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </Fragment>
              )
            })}
          </div>
        </div>

        {aVal != null && bVal != null && (
          <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
            <p className="eyebrow mb-2 text-[10px]">{t('experimentsPage.previewTitle')}</p>
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="shrink-0 font-semibold text-accent">A&ensp;{fmt(aVal)}</span>
              <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line">
                {aVal >= 0 && bVal >= 0 && aVal + bVal > 0 && (
                  <>
                    <span
                      className="h-full bg-accent"
                      style={{ width: `${(aVal / (aVal + bVal)) * 100}%` }}
                    />
                    <span
                      className="h-full"
                      style={{
                        width: `${(bVal / (aVal + bVal)) * 100}%`,
                        backgroundColor: B_COLOR,
                      }}
                    />
                  </>
                )}
              </span>
              <span className="shrink-0 font-semibold" style={{ color: B_COLOR }}>
                B&ensp;{fmt(bVal)}
              </span>
              {delta != null && (
                <span className="shrink-0 text-ink-soft">
                  Δ {delta > 0 ? '+' : ''}
                  {delta.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft hover:text-ink"
          >
            {t('experimentsPage.cancel')}
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
          >
            {busy ? t('experimentsPage.creating') : t('experimentsPage.create')}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
