import { useEffect, useState } from 'react'
import { Gauge, Plus, Trash2 } from 'lucide-react'
import { useTargetStore } from '../store/targetStore'
import type { KPITarget } from '../api/scenario'

const PERIODS = ['month', 'quarter', 'year']

function PacingGauge({ t }: { t: KPITarget }) {
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
          title={`Gözlənilən tempo: ${expected}%`}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        <span style={{ color }}>{t.pacing.attainment_pct}% icra</span>
        <span>tempo: {t.pacing.status}</span>
      </div>
    </div>
  )
}

export function TargetsPage() {
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
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <p className="eyebrow">Ssenari · FP&A</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">KPI hədəfləri</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Hədəf təyin et, tempo (pacing) ilə hədəfə çatma sürətini izlə.
        </p>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ad"
          className="col-span-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          type="number"
          placeholder="Hədəf"
          className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <input
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          type="number"
          placeholder="Cari"
          className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-xl border border-line bg-surface-2 px-2 py-2 text-sm text-ink focus:outline-none"
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="mb-6 flex justify-end">
        <button
          onClick={submit}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
        >
          <Plus size={15} /> Hədəf əlavə et
        </button>
      </div>

      {items.length === 0 ? (
        <div className="plot-grid rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <Gauge size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">Hələ hədəf yoxdur</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((t) => (
            <li key={t.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{t.name}</p>
                  <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                    {t.current_value.toLocaleString('az-AZ')} / {t.target_value.toLocaleString('az-AZ')} · {t.period}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    key={t.current_value}
                    type="number"
                    defaultValue={t.current_value}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (v !== t.current_value) update(t.id, { current_value: v }).catch(() => undefined)
                    }}
                    className="w-24 rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
                    title="Cari dəyəri yenilə"
                  />
                  <button
                    onClick={() => remove(t.id)}
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <PacingGauge t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
