import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge, Plus, Trash2 } from 'lucide-react'
import { useTargetStore } from '../store/targetStore'
import { Field, FIELD, Select } from '../components/ui/form'
import type { KPITarget } from '../api/scenario'

const PERIODS = ['month', 'quarter', 'year']

function PacingGauge({ t }: { t: KPITarget }) {
  const { t: translate } = useTranslation()
  const attain = Math.max(0, Math.min(100, t.pacing.attainment_pct))
  const expected = Math.max(0, Math.min(100, t.pacing.elapsed_pct))
  const color = t.pacing.on_track ? 'rgb(var(--accent))' : '#D87C6B'
  return (
    <div className="mt-2">
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${attain}%`, backgroundColor: color }} />
        {/* expected-pace marker */}
        <div
          className="absolute top-0 h-full w-0.5 bg-ink"
          style={{ left: `${expected}%` }}
          title={translate('targetsPage.expectedPace', { pct: expected })}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        <span style={{ color }}>{translate('targetsPage.attainment', { pct: t.pacing.attainment_pct })}</span>
        <span>{translate('targetsPage.pace', { status: t.pacing.status })}</span>
      </div>
    </div>
  )
}

export function TargetsPage() {
  const { t } = useTranslation()
  const { items, load, add, update, remove } = useTargetStore()
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [current, setCurrent] = useState('')
  const [period, setPeriod] = useState('month')

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  const submit = () => {
    if (!name.trim() || !target) return
    add({
      name: name.trim(),
      target_value: Number(target),
      current_value: Number(current) || 0,
      period,
    }).catch(() => undefined)
    setName('')
    setTarget('')
    setCurrent('')
  }

  return (
    <div className="w-full">
      <header className="mb-6">
        <p className="eyebrow">{t('targetsPage.eyebrow')}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">{t('targetsPage.title')}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t('targetsPage.subtitle')}
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="mb-6 rounded-2xl border border-line bg-surface p-5"
      >
        <p className="eyebrow mb-4">{t('targetsPage.newTarget')}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Field id="kpi-name" label={t('targetsPage.nameLabel')}>
              <input
                id="kpi-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('targetsPage.namePlaceholder')}
                className={FIELD}
              />
            </Field>
          </div>
          <Field id="kpi-target" label={t('targetsPage.targetLabel')}>
            <input
              id="kpi-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              type="number"
              step="any"
              inputMode="decimal"
              placeholder={t('targetsPage.targetPlaceholder')}
              className={FIELD}
            />
          </Field>
          <Field id="kpi-current" label={t('targetsPage.currentLabel')}>
            <input
              id="kpi-current"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              type="number"
              step="any"
              inputMode="decimal"
              placeholder={t('targetsPage.currentPlaceholder')}
              className={FIELD}
            />
          </Field>
          <Field id="kpi-period" label={t('targetsPage.periodLabel')}>
            <Select
              id="kpi-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              options={PERIODS.map((p) => ({ value: p, label: t(`targetsPage.period_${p}`) }))}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={!name.trim() || !target}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
          >
            <Plus size={15} /> {t('targetsPage.addTarget')}
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="plot-grid grid min-h-[50vh] place-items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <Gauge size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">{t('targetsPage.empty')}</p>
        </div>
      ) : (
        <ul className="grid items-start gap-3 lg:grid-cols-2">
          {items.map((kpi) => (
            <li key={kpi.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{kpi.name}</p>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                    {kpi.current_value.toLocaleString('az-AZ')} / {kpi.target_value.toLocaleString('az-AZ')} ·{' '}
                    {t(`targetsPage.period_${kpi.period}`, kpi.period)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    key={kpi.current_value}
                    type="number"
                    defaultValue={kpi.current_value}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (v !== kpi.current_value) update(kpi.id, { current_value: v }).catch(() => undefined)
                    }}
                    className="w-24 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
                    title={t('targetsPage.updateCurrentValue')}
                  />
                  <button
                    onClick={() => remove(kpi.id)}
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <PacingGauge t={kpi} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
