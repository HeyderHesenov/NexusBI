import type { QueryHistoryItem } from '../../types'

interface Props {
  items: QueryHistoryItem[]
  onSelect?: (item: QueryHistoryItem) => void
}

export function QueryHistory({ items, onSelect }: Props) {
  if (!items.length) {
    return <p className="text-sm text-slate-500">Hələ sorğu yoxdur.</p>
  }
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            onClick={() => onSelect?.(item)}
            className="w-full truncate rounded px-2 py-1 text-left text-sm text-slate-300 hover:bg-slate-800"
            title={item.natural_language}
          >
            {item.natural_language}
          </button>
        </li>
      ))}
    </ul>
  )
}
