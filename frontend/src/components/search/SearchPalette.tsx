import { Bookmark, LayoutGrid, Ruler, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { SearchHit } from '../../api/search'
import { groupHits, routeFor } from '../../lib/searchGroups'
import { useSearchStore } from '../../store/searchStore'

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutGrid,
  metric_asset: Ruler,
  saved_query: Bookmark,
}

const EXAMPLES = ['gəlir', 'churn', 'regional satış']

/** Global ⌘K command palette — top-anchored, keyboard-driven semantic search across
 * dashboards / metrics / reports. Mounted once (in Layout); owns the global hotkey. */
export function SearchPalette() {
  const { t } = useTranslation()
  const { open, query, hits, loading, setOpen, toggle, setQuery, run } = useSearchStore()
  const navigate = useNavigate()
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  const { groups, flat } = useMemo(() => groupHits(hits), [hits])
  const indexOf = useMemo(() => new Map(flat.map((h, i) => [h, i])), [flat])

  const inputRef = useRef<HTMLInputElement>(null)
  // Latest values for the window key handler (added once per open cycle).
  const activeRef = useRef(0)
  activeRef.current = active
  const flatRef = useRef(flat)
  flatRef.current = flat

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

  // While open: lock body scroll and restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
      restoreRef.current?.focus?.()
    }
  }, [open])

  // Debounced search as the user types.
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => run(query), 200)
    return () => clearTimeout(id)
  }, [open, query, run])

  // New results → reset the highlight to the top.
  useEffect(() => setActive(0), [hits])

  // Keep the active row in view as it moves.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = (hit: SearchHit) => {
    navigate(routeFor(hit.kind))
    setOpen(false)
  }

  // While open: handle navigation at the WINDOW level so Escape/arrows/Enter work
  // regardless of where focus is (an example chip, etc.), and trap Tab inside the
  // palette (focus stays on the input — the honest aria-modal contract).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => Math.min(a + 1, flatRef.current.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const hit = flatRef.current[activeRef.current]
        if (hit) go(hit)
      } else if (e.key === 'Tab') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const showEmpty = !query.trim()
  const showNoResults = !!query.trim() && !loading && flat.length === 0
  const showSkeleton = !!query.trim() && loading && flat.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-sm"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('searchPalette.dialogLabel')}
        onMouseDown={(e) => e.stopPropagation()}
        className="palette-in relative flex max-h-[62vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop"
      >
        <div className="plot-grid pointer-events-none absolute inset-0 opacity-40" />

        {/* Input row — the query-console caret ties search to the ask experience. */}
        <div className="relative flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <span className="font-mono text-base leading-none text-accent">›</span>
          <Search size={16} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="search-listbox"
            aria-activedescendant={
              flat[active] ? `hit-${flat[active].kind}-${flat[active].ref_id}` : undefined
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPalette.inputPlaceholder')}
            className="flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            esc
          </kbd>
        </div>

        {/* Screen-reader result count — kept OUTSIDE the listbox content model. */}
        <div aria-live="polite" className="sr-only">
          {query.trim() ? t('searchPalette.resultCount', { n: flat.length }) : ''}
        </div>

        {/* Results */}
        <div ref={listRef} id="search-listbox" role="listbox" className="relative min-h-0 flex-1 overflow-auto p-2">
          {showEmpty && (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-ink-faint">{t('searchPalette.emptyHint')}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((x) => (
                  <button
                    key={x}
                    onClick={() => setQuery(x)}
                    className="cursor-pointer rounded-full border border-line px-3 py-1 text-xs text-ink-soft transition-colors hover:border-accent hover:text-ink"
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showSkeleton && (
            <div className="space-y-1.5 p-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-surface-2" />
              ))}
            </div>
          )}

          {showNoResults && (
            <p className="px-3 py-8 text-center text-sm text-ink-faint">{t('searchPalette.noResults')}</p>
          )}

          {groups.map((group) => (
            <div key={group.kind} className="mb-1">
              <div className="flex items-center justify-between px-3 pb-1 pt-2">
                <span className="eyebrow text-ink-faint">{group.label}</span>
                <span className="font-mono text-[10px] text-ink-faint">{group.hits.length}</span>
              </div>
              {group.hits.map((hit) => {
                const idx = indexOf.get(hit) ?? 0
                const isActive = idx === active
                const Icon = ICONS[hit.kind] ?? Search
                return (
                  <div
                    key={`${hit.kind}-${hit.ref_id}`}
                    id={`hit-${hit.kind}-${hit.ref_id}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onMouseMove={(e) => {
                      // Only real pointer movement re-highlights — a keyboard-driven
                      // scrollIntoView moving a row under an idle cursor must not
                      // steal the highlight back.
                      if (e.movementX || e.movementY) setActive(idx)
                    }}
                    onClick={() => go(hit)}
                    className={`relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
                      isActive ? 'bg-surface-2 text-ink' : 'text-ink-soft hover:bg-surface-2/60'
                    }`}
                  >
                    <span
                      className={`absolute inset-y-1.5 left-0 w-0.5 rounded-full ${
                        isActive ? 'bg-accent' : 'bg-transparent'
                      }`}
                    />
                    <Icon size={15} className={isActive ? 'text-accent' : 'text-ink-faint'} />
                    <span className="flex-1 truncate text-sm">{hit.title}</span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer key hints */}
        <div className="relative flex items-center gap-4 border-t border-line px-4 py-2.5 font-mono text-[10px] text-ink-faint">
          <span>{t('searchPalette.hintNavigate')}</span>
          <span>{t('searchPalette.hintOpen')}</span>
          <span>{t('searchPalette.hintClose')}</span>
        </div>
      </div>
    </div>
  )
}
