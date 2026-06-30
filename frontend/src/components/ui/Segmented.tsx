import { useRef } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  Icon?: LucideIcon
  count?: number
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}

/**
 * Single-select filter chips. Modelled as a WAI-ARIA radiogroup (not a tablist —
 * there is no associated tabpanel; these pick one filter), so selection following
 * arrow-key focus is the expected behaviour. Roving tabindex + ←/→/↑/↓/Home/End.
 */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const focusAt = (i: number) => {
    const next = (i + options.length) % options.length
    refs.current[next]?.focus()
    onChange(options[next].value)
  }

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      focusAt(i + 1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      focusAt(i - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusAt(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusAt(options.length - 1)
    }
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'border-accent bg-accent text-bg'
                : 'border-line text-ink-soft hover:border-line-strong hover:text-ink'
            }`}
          >
            {opt.Icon && <opt.Icon size={14} />}
            {opt.label}
            {opt.count != null && opt.count > 0 && (
              <span
                className={`ml-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold ${
                  active ? 'bg-bg/25 text-bg' : 'bg-accent-soft text-accent'
                }`}
              >
                {opt.count > 9 ? '9+' : opt.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
