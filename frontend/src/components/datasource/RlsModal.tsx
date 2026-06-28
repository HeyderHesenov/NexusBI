import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, ShieldHalf, Trash2 } from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import * as dsApi from '../../api/datasource'
import type { RLSRule } from '../../api/datasource'

interface Props {
  open: boolean
  onClose: () => void
  datasourceId: string | null
  datasourceName: string
}

/** Manage row-level security rules for one datasource (owner only). */
export function RlsModal({ open, onClose, datasourceId, datasourceName }: Props) {
  const [rules, setRules] = useState<RLSRule[]>([])
  const [email, setEmail] = useState('')
  const [column, setColumn] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && datasourceId) {
      dsApi.listRls(datasourceId).then(setRules).catch(() => setRules([]))
    }
  }, [open, datasourceId])

  const add = async () => {
    if (!datasourceId || !email.trim() || !column.trim() || !value.trim() || busy) return
    setBusy(true)
    try {
      await dsApi.addRls(datasourceId, email.trim(), column.trim(), value.trim())
      setRules(await dsApi.listRls(datasourceId))
      setEmail('')
      setColumn('')
      setValue('')
      toast.success('Qayda əlavə olundu.')
    } catch {
      /* interceptor toast */
    } finally {
      setBusy(false)
    }
  }

  const remove = async (ruleId: string) => {
    if (!datasourceId) return
    await dsApi.removeRls(datasourceId, ruleId)
    setRules(rules.filter((r) => r.id !== ruleId))
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Sətir-səviyyə təhlükəsizlik (RLS)"
      subtitle={`${datasourceName}: üzv yalnız icazə verilən sətirləri görür.`}
      footer={
        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            Bağla
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        {rules.length > 0 && (
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2 text-ink-soft">
                  <ShieldHalf size={13} className="text-accent" />
                  <code className="font-mono text-xs">
                    {r.column} = {r.allowed_value}
                  </code>
                </span>
                <button
                  onClick={() => remove(r.id)}
                  className="rounded-md border border-line p-1 text-ink-faint transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="üzv e-poçtu"
            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <input
              value={column}
              onChange={(e) => setColumn(e.target.value)}
              placeholder="sütun (məs. region)"
              className="flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="icazəli dəyər"
              className="flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
          </div>
          <button
            onClick={add}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            <Plus size={14} /> Qayda əlavə et
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
