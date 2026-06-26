import { useTypewriter } from '../../hooks/useTypewriter'

/** Reveals AI insight text with a typewriter effect. Mount this with a stable
 *  `key` (e.g. query_log_id) so each result animates exactly once. */
export function TypewriterText({ text, className }: { text: string; className?: string }) {
  const shown = useTypewriter(text)
  const typing = shown.length < text.length
  return (
    <p className={className}>
      {shown}
      {typing && (
        <span className="ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[1px] animate-pulse bg-accent align-middle" />
      )}
    </p>
  )
}
