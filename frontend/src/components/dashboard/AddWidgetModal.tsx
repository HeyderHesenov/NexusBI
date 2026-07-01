import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { QueryHistoryItem } from '../../types'
import { useQueryStore } from '../../store/queryStore'
import { ModalShell } from '../ui/ModalShell'

interface Props {
  open: boolean
  onClose: () => void
  onPick: (item: QueryHistoryItem) => void
}

export function AddWidgetModal({ open, onClose, onPick }: Props) {
  const { t } = useTranslation()
  const { history, loadHistory } = useQueryStore()

  useEffect(() => {
    if (open) loadHistory().catch(() => undefined)
  }, [open, loadHistory])

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('addWidgetModal.title')}
      subtitle={t('addWidgetModal.subtitle')}
      footer={
        <div className="text-right">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-ink-soft transition hover:text-ink"
          >
            {t('addWidgetModal.close')}
          </button>
        </div>
      }
    >
      {history.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-ink-faint">
          {t('addWidgetModal.emptyState')}
        </p>
      ) : (
        <ul className="space-y-1 p-2">
          {history.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => onPick(item)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-2"
              >
                <span className="min-w-0 truncate text-sm text-ink">{item.natural_language}</span>
                <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] text-accent">
                  {item.chart_type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  )
}
