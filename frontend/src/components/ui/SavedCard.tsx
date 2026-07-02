import { Trash2 } from 'lucide-react'

interface Props {
  active: boolean
  title: string
  subtitle: string
  deleteLabel: string
  onSelect: () => void
  onDelete: () => void
}

/** Selectable saved-item card with a hover-revealed delete — the shared shape
 * for BA Studio artifacts, AutoML models, and future saved-thing lists. */
export function SavedCard({ active, title, subtitle, deleteLabel, onSelect, onDelete }: Props) {
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
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        className="rounded-md p-1 text-ink-faint opacity-0 transition hover:text-[#D87C6B] focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
