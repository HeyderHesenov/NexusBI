import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

export function SQLPreview({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-3 py-2 text-sm text-slate-300"
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        Generasiya olunmuş SQL
      </button>
      {open && (
        <pre className="overflow-auto border-t border-slate-700 px-4 py-3 text-xs text-teal-300">
          {sql}
        </pre>
      )}
    </div>
  )
}
