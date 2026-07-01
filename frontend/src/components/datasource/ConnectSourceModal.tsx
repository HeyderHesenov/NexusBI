import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from '../ui/ModalShell'
import { Field, Select } from '../ui/form'
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
  mysql: 'mysql+aiomysql://user:pass@host:3306/db',
  sqlite: 'sqlite+aiosqlite:///absolute/path.db',
}

export function ConnectSourceModal({ open, onClose }: Props) {
  const { t } = useTranslation()
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
      title={t('connectSourceModal.title')}
      subtitle={t('connectSourceModal.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('connectSourceModal.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            {busy ? t('connectSourceModal.connecting') : t('connectSourceModal.connect')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <Field id="cs-name" label={t('connectSourceModal.nameLabel')}>
          <input
            id="cs-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('connectSourceModal.namePlaceholder')}
            className={field}
          />
        </Field>
        <Field id="cs-type" label={t('connectSourceModal.typeLabel')}>
          <Select
            id="cs-type"
            value={dbType}
            onChange={(e) => setDbType(e.target.value as DataSourceCreate['db_type'])}
            options={[
              { value: 'postgresql', label: 'PostgreSQL' },
              { value: 'mysql', label: 'MySQL' },
              { value: 'sqlite', label: 'SQLite' },
            ]}
          />
        </Field>
        <Field id="cs-conn" label={t('connectSourceModal.connLabel')} hint={t('connectSourceModal.readOnlyNote')}>
          <input
            id="cs-conn"
            value={conn}
            onChange={(e) => setConn(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={PLACEHOLDER[dbType]}
            className={`${field} font-mono text-xs`}
          />
        </Field>
      </div>
    </ModalShell>
  )
}
