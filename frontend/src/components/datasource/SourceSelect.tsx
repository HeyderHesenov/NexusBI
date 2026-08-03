import type { ReactNode } from 'react'
import { ChevronDown, Database } from 'lucide-react'
import type { DataSource } from '../../types'

/** Which dialect the surrounding surface speaks.
 *
 *  `toolbar` — 30px, matches the mode toggle and the buttons on the query
 *  console's control row. `field` — 38px, matches the `FIELD` metrics used by
 *  stacked forms (requirements, modals). Picking the wrong one is the bug this
 *  component was written to fix, so it is a deliberate choice, not a default. */
type SourceSelectSize = 'toolbar' | 'field'

const SIZES: Record<SourceSelectSize, { shell: string; label: string; select: string; chevron: string }> = {
  // Height is stated, not derived: Gecko forces `line-height: normal` on
  // <select>, so a height inferred from text-xs lands a couple of px short
  // there while the neighbouring buttons stay put.
  toolbar: {
    shell: 'rounded-lg',
    label: 'pl-2.5 gap-2',
    select: 'h-7 max-w-[180px] pr-7 text-xs',
    chevron: 'right-1.5',
  },
  field: {
    shell: 'rounded-xl',
    label: 'pl-3 gap-2',
    select: 'h-9 max-w-[240px] pr-8 text-sm',
    chevron: 'right-2.5',
  },
}

interface SourceSelectProps {
  /** Selected source id, or null for demo data. */
  value: string | null
  onChange: (id: string | null) => void
  /** Accessible name for the select — the visible label is icon-only. */
  label: string
  /** Copy for the "no source of your own" option. */
  demoLabel: string
  sources: DataSource[]
  size?: SourceSelectSize
  disabled?: boolean
  /** Rendered inside the same shell, behind a hairline divider.
   *
   *  The slot owns its own horizontal padding and text size, and must use
   *  `ring-inset` for focus — the shell clips overflow, so an outset ring on a
   *  descendant would be cut off. Kept as a slot rather than baked in so this
   *  component stays presentational and router-free; `/requirements` uses it
   *  with no trailing action at all. */
  trailing?: ReactNode
}

/** Source picker shared by the query console and the requirements builder.
 *
 *  `appearance-none` is load-bearing, not cosmetic: a menulist select takes its
 *  height from the UA, so the row could not be aligned at all while the browser
 *  owned that number. It also caps a long source name instead of letting it
 *  stretch the control. */
export function SourceSelect({
  value,
  onChange,
  label,
  demoLabel,
  sources,
  size = 'toolbar',
  disabled,
  trailing,
}: SourceSelectProps) {
  const s = SIZES[size]
  const selected = sources.find((src) => src.id === value)

  return (
    <div
      className={`inline-flex items-stretch overflow-hidden border border-line bg-surface-2 transition-colors hover:border-line-strong ${s.shell}`}
    >
      <label
        className={`relative inline-flex items-center focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent ${s.label}`}
      >
        {/* Accent means "your own data", not "there is a picker here" — the mode
          * toggle two controls over already spends green on state. Keyed on the
          * source actually existing, so a row deleted in another tab can't leave
          * a green icon sitting next to the words "Demo data". */}
        <Database
          size={14}
          aria-hidden="true"
          className={`shrink-0 transition-colors ${selected ? 'text-accent' : 'text-ink-faint'}`}
        />
        <select
          aria-label={label}
          // The name is capped and clipped, so hover has to be able to show it
          // in full — nothing else in the row can.
          title={selected?.name ?? demoLabel}
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          className={`cursor-pointer appearance-none truncate bg-transparent font-medium text-ink focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${s.select}`}
        >
          <option value="">{demoLabel}</option>
          {sources.map((src) => (
            <option key={src.id} value={src.id}>
              {src.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-faint ${s.chevron}`}
        />
      </label>
      {trailing && (
        <>
          <span aria-hidden="true" className="w-px shrink-0 bg-line" />
          {trailing}
        </>
      )}
    </div>
  )
}
