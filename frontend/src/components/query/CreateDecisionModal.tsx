import { useState } from 'react'
import { ModalShell } from '../ui/ModalShell'
import { useDecisionStore } from '../../store/decisionStore'

interface Props {
  open: boolean
  onClose: () => void
  insight: string
  queryLogId: string | null
}

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

export function CreateDecisionModal({ open, onClose, insight, queryLogId }: Props) {
  const add = useDecisionStore((s) => s.add)
  const [title, setTitle] = useState('')
  const [action, setAction] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      await add({ title: title.trim(), insight, action: action.trim(), query_log_id: queryLogId })
      setTitle('')
      setAction('')
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
      title="Qərara çevir"
      subtitle="Bu insight-dan izlənən bir qərar yarat."
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
            Yarat
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        {insight && (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-soft">
            {insight}
          </p>
        )}
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Qərar başlığı" className={field} />
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Atılacaq addım (opsional)" className={field} />
      </div>
    </ModalShell>
  )
}
