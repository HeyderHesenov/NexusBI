/**
 * NexusBI mark — four data nodes linked into a nexus.
 * Lines use currentColor; nodes use the emerald accent. Size-scalable.
 */
export function NexusMark({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* links */}
      <g stroke="rgb(var(--accent))" strokeWidth="1.6" strokeLinecap="round" opacity="0.55">
        <line x1="6" y1="6" x2="18" y2="6" />
        <line x1="6" y1="6" x2="6" y2="18" />
        <line x1="18" y1="6" x2="18" y2="18" />
        <line x1="6" y1="18" x2="18" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </g>
      {/* nodes */}
      <g fill="rgb(var(--surface-2))" stroke="rgb(var(--accent))" strokeWidth="1.6">
        <circle cx="6" cy="18" r="2.4" />
        <circle cx="18" cy="6" r="2.4" />
        <circle cx="6" cy="6" r="2.4" />
      </g>
      {/* active node — the resolved insight */}
      <circle cx="18" cy="18" r="3" fill="rgb(var(--accent))" />
    </svg>
  )
}

/** Mark + wordmark lockup. */
export function NexusLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <NexusMark size={26} />
      <span className="font-display text-lg font-bold tracking-tight text-ink">
        Nexus<span className="text-accent">BI</span>
      </span>
    </span>
  )
}
