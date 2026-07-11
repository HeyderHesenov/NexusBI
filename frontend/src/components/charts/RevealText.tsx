import { useEffect } from 'react'

/** Shows AI insight text as a whole with a single soft fade-in (no
 *  character-by-character typewriter). Mount with a stable `key` (e.g.
 *  query_log_id) so each new result replays the fade. `onType` fires once when
 *  the text changes (e.g. to keep a chat scrolled to the bottom). */
export function RevealText({
  text,
  className,
  onType,
}: {
  text: string
  className?: string
  onType?: () => void
}) {
  useEffect(() => {
    onType?.()
  }, [text, onType])
  return <p className={['fade-in', className].filter(Boolean).join(' ')}>{text}</p>
}
