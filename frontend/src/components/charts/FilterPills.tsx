import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface Filter {
  field: string
  value: string
}

interface Props {
  filters: Filter[]
  onRemove: (index: number) => void
  onClear: () => void
}

/** Active drill-down filters applied to a chart, as removable pills. */
export function FilterPills({ filters, onRemove, onClear }: Props) {
  const { t } = useTranslation()
  if (!filters.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        {t('filterPills.filter')}
      </span>
      {filters.map((f, i) => (
        <button
          key={`${f.field}:${f.value}`}
          onClick={() => onRemove(i)}
          className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-xs text-ink transition-colors hover:border-accent"
        >
          <span className="text-ink-soft">{f.field}:</span>
          <span className="font-medium">{f.value}</span>
          <X size={12} className="text-ink-faint" />
        </button>
      ))}
      <button
        onClick={onClear}
        className="ml-1 text-xs text-ink-faint underline-offset-2 transition-colors hover:text-ink hover:underline"
      >
        {t('filterPills.clear')}
      </button>
    </div>
  )
}
