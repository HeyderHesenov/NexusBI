/** Circular initials badge for a person (member, chat author, DM peer).
 *
 * Single source of the account-avatar look first used inline in SidebarAccount —
 * derive the initial from name, then email, then a `?` fallback. Initials-only by
 * design: the User model has no avatar image yet. */
interface AvatarProps {
  name?: string | null
  email?: string | null
  size?: 'sm' | 'md'
  className?: string
}

const SIZES = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-8 w-8 text-xs',
} as const

export function Avatar({ name, email, size = 'md', className = '' }: AvatarProps) {
  const source = name || email || '?'
  const initial = source.charAt(0).toUpperCase() || '?'
  return (
    <span
      aria-hidden="true"
      className={`grid ${SIZES[size]} shrink-0 place-items-center rounded-full bg-accent font-semibold text-bg ${className}`}
    >
      {initial}
    </span>
  )
}
