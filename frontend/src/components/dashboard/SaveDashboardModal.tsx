import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from '../ui/ModalShell'

interface Props {
  open: boolean
  onClose: () => void
  onSave: (name: string) => void
}

export function SaveDashboardModal({ open, onClose, onSave }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const submit = () => name.trim() && onSave(name.trim())

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('saveDashboardModal.title')}
      subtitle={t('saveDashboardModal.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
          >
            {t('saveDashboardModal.cancel')}
          </button>
          <button
            onClick={submit}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px"
          >
            {t('saveDashboardModal.create')}
          </button>
        </div>
      }
    >
      <div className="p-5">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={t('saveDashboardModal.namePlaceholder')}
          className="w-full rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>
    </ModalShell>
  )
}
