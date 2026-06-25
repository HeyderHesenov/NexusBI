import { useState } from 'react'
import { ModalShell } from '../ui/ModalShell'
import { useSavedQueryStore } from '../../store/savedQueryStore'
import type { Schedule } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  nlQuery: string
  datasourceId: string | null
}

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

const SCHEDULES: { value: Schedule; label: string }[] = [
  { value: 'off', label: 'Cədvəl yox' },
  { value: 'hourly', label: 'Saatlıq' },
  { value: 'daily', label: 'Gündəlik' },
  { value: 'weekly', label: 'Həftəlik' },
]

export function SaveQueryModal({ open, onClose, nlQuery, datasourceId }: Props) {
  const save = useSavedQueryStore((s) => s.save)
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState<Schedule>('off')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await save({ name: name.trim(), nl_query: nlQuery, datasource_id: datasourceId, schedule })
      setName('')
      setSchedule('off')
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Sorğunu saxla"
      subtitle="Adlandır və istəyə görə avto-yeniləmə cədvəli ver."
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
            Saxla
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-soft">
          “{nlQuery}”
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Ad (məs. Həftəlik satış)"
          className={field}
        />
        <select value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule)} className={field}>
          {SCHEDULES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </ModalShell>
  )
}
