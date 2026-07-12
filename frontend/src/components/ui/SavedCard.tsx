import { Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  active: boolean
  title: string
  subtitle: string
  deleteLabel: string
  onSelect: () => void
  onDelete: () => void
  /** Extra hover-revealed actions rendered before the delete button. */
  actions?: ReactNode
}

/** Selectable saved-item card with a hover-revealed delete — the shared shape
 * for BA Studio artifacts, AutoML models, and future saved-thing lists. */
export function SavedCard({ active, title, subtitle, deleteLabel, onSelect, onDelete, actions }: Props) {
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition ${
        active ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-ink-faint'
      }`}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-faint">{subtitle}</p>
      </button>
      <span className="flex shrink-0 items-center opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
        {actions}
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          className="rounded-md p-1 text-ink-faint transition hover:text-[#D87C6B]"
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  )
}
