import { useEffect } from 'react'
import { useTypewriter } from '../../hooks/useTypewriter'

/** Reveals AI insight text with a typewriter effect. Mount this with a stable
 *  `key` (e.g. query_log_id) so each result animates exactly once. `onType`
 *  fires on each reveal step (e.g. to keep a chat scrolled to the bottom). */
export function TypewriterText({
  text,
  className,
  onType,
}: {
  text: string
  className?: string
  onType?: () => void
}) {
  const shown = useTypewriter(text)
  const typing = shown.length < text.length
  useEffect(() => {
    onType?.()
  }, [shown, onType])
  return (
    <p className={className}>
      {shown}
      {typing && (
        <span className="ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[1px] animate-pulse bg-accent align-middle" />
      )}
    </p>
  )
}
