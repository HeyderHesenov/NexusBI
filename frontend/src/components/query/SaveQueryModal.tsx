import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from '../ui/ModalShell'
import { Field, Select } from '../ui/form'
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

const SCHEDULES: { value: Schedule; labelKey: string }[] = [
  { value: 'off', labelKey: 'saveQueryModal.scheduleOff' },
  { value: 'hourly', labelKey: 'saveQueryModal.scheduleHourly' },
  { value: 'daily', labelKey: 'saveQueryModal.scheduleDaily' },
  { value: 'weekly', labelKey: 'saveQueryModal.scheduleWeekly' },
]

export function SaveQueryModal({ open, onClose, nlQuery, datasourceId }: Props) {
  const { t } = useTranslation()
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
      title={t('saveQueryModal.title')}
      subtitle={t('saveQueryModal.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink">
            {t('saveQueryModal.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            {t('saveQueryModal.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-soft">
          “{nlQuery}”
        </p>
        <Field id="sq-name" label={t('saveQueryModal.nameLabel')}>
          <input
            id="sq-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('saveQueryModal.namePlaceholder')}
            className={field}
          />
        </Field>
        <Field id="sq-schedule" label={t('saveQueryModal.scheduleLabel')}>
          <Select
            id="sq-schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as Schedule)}
            options={SCHEDULES.map((s) => ({ value: s.value, label: t(s.labelKey) }))}
          />
        </Field>
      </div>
    </ModalShell>
  )
}
