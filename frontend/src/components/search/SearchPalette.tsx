import { Bookmark, LayoutGrid, Ruler, Search } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SearchHit } from '../../api/search'
import { useSearchStore } from '../../store/searchStore'
import { ModalShell } from '../ui/ModalShell'

const KIND_META: Record<SearchHit['kind'], { label: string; route: string; Icon: typeof LayoutGrid }> = {
  dashboard: { label: 'Dashboard', route: '/dashboards', Icon: LayoutGrid },
  metric_asset: { label: 'Metrik', route: '/metrics', Icon: Ruler },
  saved_query: { label: 'Hesabat', route: '/reports', Icon: Bookmark },
}

/** Global ⌘K command palette — semantic search across dashboards/metrics/reports.
 * Mounted once (in Layout); owns the global hotkey. */
export function SearchPalette() {
  const { open, query, hits, loading, setOpen, toggle, setQuery, run } = useSearchStore()
  const navigate = useNavigate()

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  // Debounced search as the user types.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => run(query), 200)
    return () => clearTimeout(id)
  }, [open, query, run])

  const go = (hit: SearchHit) => {
    navigate(KIND_META[hit.kind]?.route ?? '/')
    setOpen(false)
  }

  return (
    <ModalShell open={open} onClose={() => setOpen(false)}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Search size={16} className="shrink-0 text-ink-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) go(hits[0])
          }}
          placeholder="Dashboard, metrik, hesabat axtar…"
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">esc</kbd>
      </div>

      <div className="max-h-[50vh] overflow-auto p-2">
        {query.trim() && !loading && hits.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-ink-faint">Nəticə tapılmadı.</p>
        )}
        {!query.trim() && (
          <p className="px-3 py-6 text-center text-sm text-ink-faint">
            Adı və ya mənası ilə axtar — “gəlir”, “churn”, “regional satış”.
          </p>
        )}
        <ul className="space-y-1">
          {hits.map((hit) => {
            const meta = KIND_META[hit.kind]
            const Icon = meta?.Icon ?? Search
            return (
              <li key={`${hit.kind}:${hit.ref_id}`}>
                <button
                  onClick={() => go(hit)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface-2"
                >
                  <Icon size={15} className="shrink-0 text-accent" />
                  <span className="flex-1 truncate text-sm text-ink">{hit.title}</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    {meta?.label ?? hit.kind}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </ModalShell>
  )
}
