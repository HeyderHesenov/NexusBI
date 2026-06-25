import { useState } from 'react'
import { ModalShell } from '../ui/ModalShell'
import { useDatasourceStore } from '../../store/datasourceStore'
import type { DataSourceCreate } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
}

const field =
  'w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

const PLACEHOLDER: Record<string, string> = {
  postgresql: 'postgresql+asyncpg://user:pass@host:5432/db',
  sqlite: 'sqlite+aiosqlite:///absolute/path.db',
}

export function ConnectSourceModal({ open, onClose }: Props) {
  const createSource = useDatasourceStore((s) => s.create)
  const [name, setName] = useState('')
  const [dbType, setDbType] = useState<DataSourceCreate['db_type']>('postgresql')
  const [conn, setConn] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setName('')
    setConn('')
    setDbType('postgresql')
  }

  const submit = async () => {
    if (!name.trim() || !conn.trim() || busy) return
    setBusy(true)
    try {
      await createSource({ name: name.trim(), db_type: dbType, connection_string: conn.trim() })
      reset()
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
      title="Verilənlər bazası qoş"
      subtitle="SQLAlchemy bağlantı sətri ilə öz datanı qoş."
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
            {busy ? 'Qoşulur…' : 'Qoş'}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ad (məs. Production DB)"
          className={field}
        />
        <select value={dbType} onChange={(e) => setDbType(e.target.value as DataSourceCreate['db_type'])} className={field}>
          <option value="postgresql">PostgreSQL</option>
          <option value="sqlite">SQLite</option>
        </select>
        <input
          value={conn}
          onChange={(e) => setConn(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={PLACEHOLDER[dbType]}
          className={`${field} font-mono text-xs`}
        />
        <p className="text-xs text-ink-faint">
          Yalnız oxuma (read-only) istifadəçi tövsiyə olunur. Sorğular yalnız SELECT-dir.
        </p>
      </div>
    </ModalShell>
  )
}
