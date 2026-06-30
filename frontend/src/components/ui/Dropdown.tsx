import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface DropdownOption<T extends string> {
  value: T
  label: string
  Icon?: LucideIcon
  count?: number
}

interface DropdownProps<T extends string> {
  options: DropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

/**
 * Single-select dropdown: a chevron trigger that opens a floating listbox. Closes
 * on select / outside-click / Escape / Tab; ↑/↓ move the highlight, Enter selects.
 * Focus stays on the trigger while open (options are tabIndex -1 + aria-activedescendant),
 * so keyboard nav keeps working. (No shared outside-click hook exists — the listener is
 * inline, same idiom as ContextMenu/ModalShell.)
 */
export function Dropdown<T extends string>({ options, value, onChange, ariaLabel, className }: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0) // keyboard-highlighted index
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const baseId = useId()

  // Read latest options/value from refs so the open-effect doesn't depend on them
  // (options is a fresh array each parent render — listing it would re-run the effect
  // on every background re-render and clobber the keyboard highlight).
  const optionsRef = useRef(options)
  optionsRef.current = options
  const valueRef = useRef(value)
  valueRef.current = value

  // On open: highlight the selected option, and wire outside-click + Escape.
  useEffect(() => {
    if (!open) return
    const opts = optionsRef.current
    setActive(Math.max(0, opts.findIndex((o) => o.value === valueRef.current)))
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

  const choose = (v: T) => {
    onChange(v)
    setOpen(false)
    triggerRef.current?.focus()
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
      setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      choose(options[active].value)
    } else if (e.key === 'Tab') {
      setOpen(false) // let focus move on; don't leave an orphaned open menu
    }
  }

  if (options.length === 0) return null
  const selected = options.find((o) => o.value === value) ?? options[0]
  const SelIcon = selected.Icon
  const listId = `${baseId}-list`

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${baseId}-opt-${active}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        className="flex w-full items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink transition-colors hover:border-line-strong focus:border-accent focus:outline-none"
      >
        {SelIcon && <SelIcon size={15} className="shrink-0 text-ink-soft" />}
        <span className="truncate">{selected.label}</span>
        {selected.count != null && selected.count > 0 && (
          <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent-soft px-1 text-[10px] font-semibold text-accent">
            {selected.count > 9 ? '9+' : selected.count}
          </span>
        )}
        <ChevronDown
          size={15}
          className={`ml-auto shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-30 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-pop"
        >
          {options.map((opt, i) => {
            const isSel = opt.value === value
            const Icon = opt.Icon
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  id={`${baseId}-opt-${i}`}
                  aria-selected={isSel}
                  tabIndex={-1}
                  onClick={() => choose(opt.value)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    i === active ? 'bg-surface-2' : ''
                  } ${isSel ? 'text-ink' : 'text-ink-soft'}`}
                >
                  {Icon && <Icon size={15} className="shrink-0 text-ink-faint" />}
                  <span className="truncate">{opt.label}</span>
                  {opt.count != null && opt.count > 0 && (
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent-soft px-1 text-[10px] font-semibold text-accent">
                      {opt.count > 9 ? '9+' : opt.count}
                    </span>
                  )}
                  {isSel && <Check size={14} className="ml-auto shrink-0 text-accent" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
