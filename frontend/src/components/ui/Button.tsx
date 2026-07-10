import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Show a spinner and disable the button while an action is in flight. */
  loading?: boolean
  /** Leading icon (hidden while `loading`, which shows a spinner instead). */
  icon?: ReactNode
  className?: string
  children?: ReactNode
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
}

// Danger uses the app-wide danger hex (#D87C6B) — the codebase has no danger token.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-semibold text-bg hover:bg-accent-press active:translate-y-px',
  secondary: 'border border-line text-ink-soft hover:border-accent hover:text-ink',
  ghost: 'text-ink-soft hover:bg-surface-2 hover:text-ink',
  danger: 'border border-[#D87C6B]/40 text-[#D87C6B] hover:bg-[#D87C6B]/10',
}

/** The one primary/secondary/ghost/danger button for the whole app — replaces the
 *  copy-pasted `rounded-xl bg-accent …` strings so hover/disabled/focus stay
 *  consistent everywhere. `type` defaults to "button" (never accidental submit). */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}
