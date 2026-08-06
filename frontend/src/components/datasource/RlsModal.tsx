import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import { Lock, LockOpen, Plus, ShieldHalf, Trash2 } from 'lucide-react'
import { ModalShell } from '../ui/ModalShell'
import { Field, FIELD } from '../ui/form'
import { useDatasourceStore } from '../../store/datasourceStore'
import * as dsApi from '../../api/datasource'
import type { RLSRule } from '../../api/datasource'
import type { RlsMode } from '../../types'

interface Props {
  open: boolean
  onClose: () => void
  datasourceId: string | null
  datasourceName: string
  rlsMode: RlsMode
}

/** Manage row-level security rules for one datasource (owner only). */
export function RlsModal({ open, onClose, datasourceId, datasourceName, rlsMode }: Props) {
  const { t } = useTranslation()
  const setRlsMode = useDatasourceStore((s) => s.setRlsMode)
  const [rules, setRules] = useState<RLSRule[]>([])
  const [email, setEmail] = useState('')
  const [column, setColumn] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [modeBusy, setModeBusy] = useState(false)
  const locked = rlsMode === 'strict'

  const toggleMode = async () => {
    if (!datasourceId || modeBusy) return
    setModeBusy(true)
    try {
      await setRlsMode(datasourceId, locked ? 'open' : 'strict')
      toast.success(t(locked ? 'rlsModal.unlocked' : 'rlsModal.locked'))
    } catch {
      /* interceptor toast */
    } finally {
      setModeBusy(false)
    }
  }

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
      toast.success(t('rlsModal.ruleAdded'))
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
      title={t('rlsModal.title')}
      subtitle={t('rlsModal.subtitle', { name: datasourceName })}
      footer={
        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('rlsModal.close')}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <div className="rounded-xl border border-line bg-surface-2 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {locked ? (
                <Lock size={15} className="mt-0.5 shrink-0 text-accent" />
              ) : (
                <LockOpen size={15} className="mt-0.5 shrink-0 text-ink-faint" />
              )}
              <div>
                <p className="text-sm font-medium text-ink">{t('rlsModal.modeLabel')}</p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {t(locked ? 'rlsModal.modeStrictHint' : 'rlsModal.modeOpenHint')}
                </p>
              </div>
            </div>
            <button
              onClick={toggleMode}
              disabled={modeBusy}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                locked
                  ? 'border-accent bg-accent-soft text-accent hover:bg-accent hover:text-bg'
                  : 'border-line text-ink-soft hover:border-accent hover:text-accent'
              }`}
            >
              {t(locked ? 'rlsModal.unlock' : 'rlsModal.lock')}
            </button>
          </div>
          {locked && (
            <p className="mt-2.5 border-t border-line pt-2.5 text-xs text-ink-faint">
              {t('rlsModal.modePublicWarning')}
            </p>
          )}
        </div>
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
                  className="rounded-md border border-line p-1 text-ink-faint transition hover:border-danger/50 hover:text-danger"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            add()
          }}
          className="space-y-3 rounded-xl border border-line bg-surface-2 p-3.5"
        >
          <Field id="rls-email" label={t('rlsModal.memberEmailLabel')}>
            <input
              id="rls-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('rlsModal.memberEmailPlaceholder')}
              className={FIELD}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="rls-column" label={t('rlsModal.columnLabel')}>
              <input
                id="rls-column"
                value={column}
                onChange={(e) => setColumn(e.target.value)}
                placeholder={t('rlsModal.columnPlaceholder')}
                className={FIELD}
              />
            </Field>
            <Field id="rls-value" label={t('rlsModal.allowedValueLabel')}>
              <input
                id="rls-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t('rlsModal.allowedValuePlaceholder')}
                className={FIELD}
              />
            </Field>
          </div>
          <button
            type="submit"
            disabled={busy || !email.trim() || !column.trim() || !value.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-50"
          >
            <Plus size={14} /> {t('rlsModal.addRule')}
          </button>
        </form>
      </div>
    </ModalShell>
  )
}
