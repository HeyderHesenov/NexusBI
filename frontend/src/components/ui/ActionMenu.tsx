import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CHART_BTN } from '../charts/ChartToolbar'

export interface ActionMenuItem {
  /** Stable key (used for React keys and the DOM ids). */
  key: string
  label: string
  Icon?: LucideIcon
  onSelect: () => void
  /** Result already loaded / toggle on → shows a check + accent. */
  active?: boolean
  /** Not selectable (gate unmet, or in-flight — the label reads as loading). */
  disabled?: boolean
}

export interface ActionMenuSection {
  header: string
  items: ActionMenuItem[]
}

interface ActionMenuProps {
  triggerLabel: string
  triggerIcon?: LucideIcon
  ariaLabel: string
  sections: ActionMenuSection[]
  /** Count badge on the trigger (e.g. how many panels are open). */
  count?: number
  className?: string
}

/**
 * Action menu: a chevron trigger that opens a floating sectioned `role="menu"`.
 * Unlike {@link Dropdown} (a single-select value picker), each row fires a
 * callback and can be independently active/loading/disabled — several may be
 * "on" at once. Closes on select / outside-click / Escape / Tab; ↑/↓ move the
 * highlight across enabled rows (skipping disabled), Enter/Space fires. Focus
 * stays on the trigger while open (rows are tabIndex -1 + aria-activedescendant).
 */
export function ActionMenu({
  triggerLabel,
  triggerIcon: TriggerIcon,
  ariaLabel,
  sections,
  count,
  className,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0) // keyboard-highlighted flat index
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const baseId = useId()

  // Flatten sections to a single indexable list for keyboard nav + ids. Read the
  // latest via ref so the open-effect doesn't depend on `sections` (a fresh array
  // each render → listing it would re-run the effect on every background re-render
  // and clobber the highlight; same idiom as Dropdown).
  const flat = sections.flatMap((s) => s.items)
  const flatRef = useRef(flat)
  flatRef.current = flat

  // Index of the first enabled row, or -1 when every row is disabled (in which
  // case nothing is highlighted and aria-activedescendant is dropped).
  const firstEnabled = () => flatRef.current.findIndex((it) => !it.disabled)

  // On open: highlight the first enabled row, and wire outside-click + Escape.
  useEffect(() => {
    if (!open) return
    setActive(firstEnabled())
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const fire = (item: ActionMenuItem) => {
    if (item.disabled) return
    item.onSelect()
    setOpen(false)
    triggerRef.current?.focus()
  }

  // Step the highlight to the next enabled row in `dir` (+1 / -1), wrapping.
  const step = (dir: 1 | -1) => {
    const items = flatRef.current
    if (!items.length) return
    setActive((i) => {
      let next = i
      for (let n = 0; n < items.length; n++) {
        next = (next + dir + items.length) % items.length
        if (!items[next].disabled) return next
      }
      return i
    })
  }

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      step(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      step(-1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const item = flatRef.current[active]
      if (item) fire(item)
    } else if (e.key === 'Tab') {
      setOpen(false) // let focus move on; don't leave an orphaned open menu
    }
  }

  if (flat.length === 0) return null
  const menuId = `${baseId}-menu`
  let idx = -1 // running flat index while rendering sections

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open && active >= 0 ? `${baseId}-item-${active}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        className={`${CHART_BTN} border ${
          count ? 'border-accent text-accent' : 'border-line text-ink-soft hover:text-ink'
        }`}
      >
        {TriggerIcon && <TriggerIcon size={14} />}
        <span>{triggerLabel}</span>
        {count != null && count > 0 && (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent-soft px-1 text-[10px] font-semibold text-accent">
            {count > 9 ? '9+' : count}
          </span>
        )}
        <ChevronDown
          size={14}
          className={`text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className="absolute right-0 z-30 mt-1.5 max-h-[70vh] w-56 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {sections.map((section, si) => (
            <div
              key={section.header}
              role="group"
              aria-label={section.header}
              className={si > 0 ? 'mt-1 border-t border-line pt-1' : ''}
            >
              <p aria-hidden="true" className="eyebrow px-2.5 py-1 text-[10px] text-ink-faint">
                {section.header}
              </p>
              {section.items.map((item) => {
                idx += 1
                const i = idx
                const Icon = item.Icon
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    id={`${baseId}-item-${i}`}
                    tabIndex={-1}
                    disabled={item.disabled}
                    onClick={() => fire(item)}
                    onMouseEnter={() => !item.disabled && setActive(i)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      i === active && !item.disabled ? 'bg-surface-2' : ''
                    } ${
                      item.disabled
                        ? 'cursor-not-allowed text-ink-faint opacity-60'
                        : item.active
                          ? 'text-accent'
                          : 'text-ink-soft'
                    }`}
                  >
                    {Icon && (
                      <Icon
                        size={15}
                        className={`shrink-0 ${item.active ? 'text-accent' : 'text-ink-faint'}`}
                      />
                    )}
                    <span className="truncate">{item.label}</span>
                    {item.active && <Check size={14} className="ml-auto shrink-0 text-accent" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
