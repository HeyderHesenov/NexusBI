import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useDashboardStore } from '../../store/dashboardStore'
import { ModalShell } from '../ui/ModalShell'

interface Props {
  open: boolean
  queryLogId: string
  title: string
  onClose: () => void
}

export function SaveToDashboardModal({ open, queryLogId, title, onClose }: Props) {
  const { list, loadList, create, addWidget } = useDashboardStore()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) loadList().catch(() => undefined)
  }, [open, loadList])

  const attach = async (dashboardId: string) => {
    setBusy(true)
    try {
      await addWidget(dashboardId, queryLogId, title)
      toast.success('Dashboard-a əlavə olundu.')
      onClose()
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  const createAndAttach = async () => {
    if (!newName.trim() || busy) return
    setBusy(true)
    try {
      const dash = await create(newName.trim())
      await addWidget(dash.id, queryLogId, title)
      toast.success(`"${dash.name}" yaradıldı və əlavə olundu.`)
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
      title="Dashboard-a saxla"
      subtitle="Mövcud panel seç və ya yenisini yarat."
      footer={
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createAndAttach()}
            placeholder="Yeni dashboard adı"
            className="flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <button
            onClick={createAndAttach}
            disabled={busy || !newName.trim()}
            className="flex items-center gap-1 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-40"
          >
            <Plus size={15} strokeWidth={2.5} /> Yarat
          </button>
        </div>
      }
    >
      {list.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-ink-faint">Hələ dashboard yoxdur.</p>
      ) : (
        <ul className="space-y-1 p-2">
          {list.map((d) => (
            <li key={d.id}>
              <button
                disabled={busy}
                onClick={() => attach(d.id)}
                className="w-full truncate rounded-lg px-3 py-2.5 text-left text-sm text-ink transition hover:bg-surface-2 disabled:opacity-50"
              >
                {d.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  )
}
