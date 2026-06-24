import { ChevronDown, ChevronRight, Database } from 'lucide-react'
import { useState } from 'react'

export function SQLPreview({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-5 py-3 text-sm text-ink-soft transition hover:text-ink"
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Database size={14} />
        <span className="font-mono text-xs uppercase tracking-wider">Generasiya olunmuş SQL</span>
      </button>
      {open && (
        <pre className="overflow-auto border-t border-line bg-surface-2 px-5 py-4 text-xs leading-relaxed text-accent">
          {sql}
        </pre>
      )}
    </div>
  )
}
