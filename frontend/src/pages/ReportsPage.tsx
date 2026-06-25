import { useEffect } from 'react'
import { Clock, Play, Trash2, BookMarked } from 'lucide-react'
import { useSavedQueryStore } from '../store/savedQueryStore'
import type { Schedule } from '../types'

const SCHEDULES: { value: Schedule; label: string }[] = [
  { value: 'off', label: 'Cədvəl yox' },
  { value: 'hourly', label: 'Saatlıq' },
  { value: 'daily', label: 'Gündəlik' },
  { value: 'weekly', label: 'Həftəlik' },
]

function fmt(ts: string | null): string {
  if (!ts) return 'heç vaxt'
  return new Date(ts).toLocaleString('az-AZ', { dateStyle: 'short', timeStyle: 'short' })
}

export function ReportsPage() {
  const { items, load, run, remove, setSchedule } = useSavedQueryStore()

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <p className="eyebrow">Hesabatlar</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          Saxlanan sorğular
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Sorğunu bir kliklə yenidən işlət və ya avto-yeniləmə cədvəli təyin et.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="plot-grid rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <BookMarked size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">Hələ saxlanan sorğu yoxdur</p>
          <p className="mt-1 text-sm text-ink-soft">
            “Soruş” səhifəsində nəticənin yanındakı “Saxla” düyməsini işlət.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <li key={s.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="truncate text-sm text-ink-soft">“{s.nl_query}”</p>
                  <p className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-ink-faint">
                    <Clock size={11} /> son işləmə: {fmt(s.last_run_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <select
                    value={s.schedule}
                    onChange={(e) => setSchedule(s.id, e.target.value as Schedule)}
                    className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink-soft focus:border-accent focus:outline-none"
                  >
                    {SCHEDULES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => run(s.id)}
                    title="İndi işlət"
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent"
                  >
                    <Play size={15} />
                  </button>
                  <button
                    onClick={() => remove(s.id)}
                    title="Sil"
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
