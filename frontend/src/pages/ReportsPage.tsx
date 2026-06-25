import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { BellPlus, Clock, Play, Trash2, BookMarked } from 'lucide-react'
import { useSavedQueryStore } from '../store/savedQueryStore'
import { ModalShell } from '../components/ui/ModalShell'
import * as alertApi from '../api/alert'
import type { AlertOperator, Schedule } from '../types'

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
  const [alertFor, setAlertFor] = useState<{ id: string; name: string } | null>(null)

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
                    onClick={() => setAlertFor({ id: s.id, name: s.name })}
                    title="Alert qur"
                    className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-accent hover:text-accent"
                  >
                    <BellPlus size={15} />
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

      {alertFor && (
        <AlertModal
          savedQueryId={alertFor.id}
          savedQueryName={alertFor.name}
          onClose={() => setAlertFor(null)}
        />
      )}
    </div>
  )
}

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'
const OPERATORS: AlertOperator[] = ['>', '<', '>=', '<=', '==', '!=']

function AlertModal({
  savedQueryId,
  savedQueryName,
  onClose,
}: {
  savedQueryId: string
  savedQueryName: string
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [column, setColumn] = useState('')
  const [operator, setOperator] = useState<AlertOperator>('>')
  const [threshold, setThreshold] = useState('0')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || !column.trim() || busy) return
    setBusy(true)
    try {
      await alertApi.createAlert({
        saved_query_id: savedQueryId,
        name: name.trim(),
        column: column.trim(),
        operator,
        threshold: Number(threshold) || 0,
      })
      toast.success('Alert quruldu.')
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Alert qur"
      subtitle={`“${savedQueryName}” işləyəndə şərt pozulsa bildiriş gəlir.`}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            Ləğv et
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            Qur
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad (məs. Gəlir düşdü)" className={field} />
        <input value={column} onChange={(e) => setColumn(e.target.value)} placeholder="Sütun (məs. total)" className={`${field} font-mono text-sm`} />
        <div className="flex gap-2">
          <select value={operator} onChange={(e) => setOperator(e.target.value as AlertOperator)} className={`${field} w-24`}>
            {OPERATORS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="Hədd"
            className={`${field} font-mono`}
          />
        </div>
      </div>
    </ModalShell>
  )
}
