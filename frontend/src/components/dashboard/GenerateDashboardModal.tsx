import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModalShell } from '../ui/ModalShell'

interface Props {
  open: boolean
  onClose: () => void
  onGenerate: (goal: string) => Promise<void>
}

const EXAMPLE_KEYS = [
  'generateDashboardModal.exampleSales',
  'generateDashboardModal.exampleCustomer',
  'generateDashboardModal.exampleProduct',
]

export function GenerateDashboardModal({ open, onClose, onGenerate }: Props) {
  const { t } = useTranslation()
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const g = goal.trim()
    if (!g || busy) return
    setBusy(true)
    try {
      await onGenerate(g)
      setGoal('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={t('generateDashboardModal.title')}
      subtitle={t('generateDashboardModal.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink disabled:opacity-50"
          >
            {t('generateDashboardModal.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={busy || !goal.trim()}
            className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press active:translate-y-px disabled:opacity-60"
          >
            <Sparkles size={15} strokeWidth={2.5} />
            {busy ? t('generateDashboardModal.building') : t('generateDashboardModal.build')}
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-5">
        <textarea
          autoFocus
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit()}
          rows={3}
          placeholder={t('generateDashboardModal.placeholder')}
          className="w-full resize-none rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_KEYS.map((exKey) => (
            <button
              key={exKey}
              type="button"
              onClick={() => setGoal(t(exKey))}
              className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft transition-colors hover:border-accent hover:text-ink"
            >
              {t(exKey)}
            </button>
          ))}
        </div>
        {busy && (
          <p className="text-xs text-ink-faint">
            {t('generateDashboardModal.progress')}
          </p>
        )}
      </div>
    </ModalShell>
  )
}
