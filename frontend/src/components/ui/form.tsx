import { ChevronDown } from 'lucide-react'
import type { ReactNode, SelectHTMLAttributes } from 'react'

/** Shared input styling for text/number inputs and selects. */
export const FIELD =
  'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none'

const DANGER = '#D87C6B'

interface FieldProps {
  id: string
  label: string
  hint?: string
  error?: string | null
  children: ReactNode
}

/** Labelled form row: accessible `<label htmlFor>`, the control, then either an
 *  inline error (`role="alert"`) or a quiet hint. Wire the control itself with
 *  `id={id}` and, when erroring, `aria-describedby={`${id}-err`}`. */
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="eyebrow mb-1 block">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 text-xs" style={{ color: DANGER }}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  options: { value: string; label: string }[]
  className?: string
}

/** Styled native select: field chrome + chevron affordance (native popup). */
export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <span className={`relative block ${className ?? ''}`}>
      <select {...rest} className={`${FIELD} cursor-pointer appearance-none pr-8`}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
      />
    </span>
  )
}
