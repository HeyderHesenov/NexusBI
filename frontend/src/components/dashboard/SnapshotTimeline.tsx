import { useTranslation } from 'react-i18next'
import { Camera, Clock, Trash2, X } from 'lucide-react'
import type { SnapshotMeta } from '../../types'

interface Props {
  items: SnapshotMeta[]
  selectedId: string | null
  capturing: boolean
  loading: boolean
  onCapture: () => void
  onSelect: (id: string) => void
  onClear: () => void
  onDelete: (id: string) => void
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/** Horizontal snapshot strip — capture button + selectable timeline dots. */
export function SnapshotTimeline({
  items, selectedId, capturing, loading, onCapture, onSelect, onClear, onDelete,
}: Props) {
  const { t } = useTranslation()
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3">
      <button
        type="button"
        onClick={onCapture}
        disabled={capturing}
        className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3 py-1.5 text-sm font-semibold text-bg transition hover:bg-accent-press disabled:opacity-60"
      >
        <Camera size={14} className={capturing ? 'animate-pulse' : ''} />
        {t('timeMachine.capture')}
      </button>
      {selectedId && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1.5 rounded-xl border border-accent bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent"
        >
          <X size={14} />
          {t('timeMachine.backToNow')}
        </button>
      )}
      <div className="flex flex-1 items-center gap-1.5 overflow-x-auto py-0.5">
        {items.length === 0 ? (
          <p className="px-1 text-xs text-ink-faint">
            {loading ? t('common.loading') : t('timeMachine.empty')}
          </p>
        ) : (
          items.map((s) => (
            <span key={s.id} className="group inline-flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => (selectedId === s.id ? onClear() : onSelect(s.id))}
                aria-pressed={selectedId === s.id}
                title={s.label || fmt(s.created_at)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  selectedId === s.id
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-ink-soft hover:border-accent hover:text-ink'
                }`}
              >
                <Clock size={11} />
                <span className="font-mono">{fmt(s.created_at)}</span>
                {s.label && <span className="max-w-28 truncate">· {s.label}</span>}
                {s.origin === 'scheduled' && (
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                    {t('timeMachine.auto')}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                aria-label={t('timeMachine.delete')}
                className="ml-0.5 inline-flex rounded-md p-1 text-ink-faint opacity-0 transition hover:text-[#D87C6B] focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  )
}
