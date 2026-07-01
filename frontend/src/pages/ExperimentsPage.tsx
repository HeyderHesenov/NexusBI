import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { FlaskConical, Play, Plus, Trash2, Trophy } from 'lucide-react'
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
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('experimentsPage.title')}</h1>
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
            <ExperimentCard key={e.id} exp={e} onAnalyze={() => analyze(e.id)} onRemove={() => remove(e.id)} />
          ))}
        </ul>
      )}

      {open && <CreateModal onClose={() => setOpen(false)} onCreate={add} />}
    </div>
  )
}

function ExperimentCard({ exp, onAnalyze, onRemove }: { exp: Experiment; onAnalyze: () => Promise<void>; onRemove: () => Promise<void> }) {
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
            {exp.kind === 'conversion' ? t('experimentsPage.conversion') : t('experimentsPage.mean')}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={run}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft transition hover:border-accent hover:text-accent disabled:opacity-60"
          >
            <Play size={13} /> {busy ? t('experimentsPage.analyzing') : t('experimentsPage.analyze')}
          </button>
          <button onClick={onRemove} aria-label={t('experimentsPage.delete')} className="rounded-lg border border-line p-1.5 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]">
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
            <p className={`text-sm font-medium ${r.significant ? 'text-ink' : 'text-ink-soft'}`}>{r.verdict}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['a', 'b'] as const).map((k) => {
              const label = k === 'a' ? exp.a_label : exp.b_label
              const val = r.metric[k]
              const isWinner = r.winner === label
              return (
                <div key={k} className="rounded-xl border border-line bg-surface-2 p-3">
                  <p className="text-xs text-ink-soft">{label}</p>
                  <p className={`font-display text-xl font-bold ${isWinner ? 'text-accent' : 'text-ink'}`}>
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

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (p: import('../types').ExperimentCreate) => Promise<void> }) {
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

  const valid =
    name.trim() !== '' && fields.every((f) => !Number.isNaN(num(a[f] ?? '')) && !Number.isNaN(num(b[f] ?? '')))

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    const toNums = (o: Record<string, string>) => Object.fromEntries(fields.map((f) => [f, num(o[f])]))
    try {
      await onCreate({ name: name.trim(), kind, data: { a: toNums(a), b: toNums(b) } })
      onClose()
    } catch {
      toast.error(t('experimentsPage.createError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell open onClose={onClose} title={t('experimentsPage.modalTitle')} subtitle={t('experimentsPage.modalSubtitle')}>
      <div className="space-y-4">
        <div>
          <p className="eyebrow mb-1">{t('experimentsPage.nameLabel')}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder={t('experimentsPage.namePlaceholder')} />
        </div>
        <div>
          <p className="eyebrow mb-1">{t('experimentsPage.metricType')}</p>
          <div className="flex gap-2">
            {(['conversion', 'mean'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${
                  kind === k ? 'border-accent bg-accent text-bg' : 'border-line text-ink-soft hover:text-ink'
                }`}
              >
                {k === 'conversion' ? t('experimentsPage.conversionRate') : t('experimentsPage.meanQuantity')}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['a', 'b'] as const).map((variant) => {
            const state = variant === 'a' ? a : b
            const setState = variant === 'a' ? setA : setB
            return (
              <div key={variant} className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
                <p className="text-xs font-semibold text-ink">{variant === 'a' ? t('experimentsPage.variantA') : t('experimentsPage.variantB')}</p>
                {fields.map((f) => (
                  <div key={f}>
                    <p className="mb-1 text-[11px] text-ink-soft">{labels[f]}</p>
                    <input
                      type="number"
                      value={state[f] ?? ''}
                      onChange={(e) => setState((s) => ({ ...s, [f]: e.target.value }))}
                      className={field}
                    />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-xl border border-line px-3 py-2 text-sm text-ink-soft hover:text-ink">
            {t('experimentsPage.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!valid || busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-50"
          >
            {busy ? t('experimentsPage.creating') : t('experimentsPage.create')}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
