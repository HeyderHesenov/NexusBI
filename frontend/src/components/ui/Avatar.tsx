/** Circular initials badge for a person (member, chat author, DM peer).
 *
 * Single source of the account-avatar look first used inline in SidebarAccount —
 * derive the initial from name, then email, then a `?` fallback. Initials-only by
 * design: the User model has no avatar image yet. */
interface AvatarProps {
  name?: string | null
  email?: string | null
  size?: 'sm' | 'md' | 'lg'
  /** Stable string (e.g. user id) → deterministic per-person hue, so the same
   *  person is the same color everywhere. Omit for the default accent badge. */
  colorSeed?: string
  className?: string
}

const SIZES = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-9 w-9 text-sm',
} as const

/** djb2 over the seed → hue. Shared with chat author-name tinting. */
export const avatarHue = (seed: string): number => {
  let h = 5381
  for (let i = 0; i < seed.length; i += 1) h = (h * 33) ^ seed.charCodeAt(i)
  return Math.abs(h) % 360
}

export function Avatar({ name, email, size = 'md', colorSeed, className = '' }: AvatarProps) {
  const source = name || email || '?'
  const initial = source.charAt(0).toUpperCase() || '?'
  const seeded = colorSeed
    ? { style: { backgroundColor: `hsl(${avatarHue(colorSeed)} 55% 42%)` }, tone: 'text-white' }
    : { style: undefined, tone: 'bg-accent text-bg' }
  return (
    <span
      aria-hidden="true"
      style={seeded.style}
      className={`grid ${SIZES[size]} shrink-0 place-items-center rounded-full font-semibold ${seeded.tone} ${className}`}
    >
      {initial}
    </span>
  )
}
