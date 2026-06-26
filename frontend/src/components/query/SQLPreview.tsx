import { ChevronDown, ChevronRight, Database } from 'lucide-react'
import { useState } from 'react'

export function SQLPreview({ sql, language = 'sql' }: { sql: string; language?: 'sql' | 'dax' }) {
  const [open, setOpen] = useState(false)
  const label = language === 'dax' ? 'Generasiya olunmuş DAX' : 'Generasiya olunmuş SQL'
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm text-ink-soft transition hover:text-ink"
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Database size={14} />
        <span className="font-mono text-xs uppercase tracking-wider">{label}</span>
      </button>
      {open && (
        <pre className="overflow-auto border-t border-line bg-surface-2 px-5 py-4 text-xs leading-relaxed text-accent">
          {sql}
        </pre>
      )}
    </div>
  )
}
