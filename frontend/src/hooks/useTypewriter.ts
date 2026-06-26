import { useEffect, useRef, useState } from 'react'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Progressively reveals `text` like a typewriter. Reveals the full string
 * instantly when the user prefers reduced motion. Restarts whenever `text`
 * changes; cleans up its timer on unmount.
 *
 * @param charsPerTick how many characters to add each animation frame
 */
export function useTypewriter(text: string, charsPerTick = 2): string {
  const [count, setCount] = useState(() => (prefersReducedMotion() ? text.length : 0))
  const raf = useRef<number | null>(null)

  useEffect(() => {
    if (prefersReducedMotion() || !text) {
      setCount(text.length)
      return
    }
    setCount(0)
    let i = 0
    const step = () => {
      i = Math.min(text.length, i + charsPerTick)
      setCount(i)
      if (i < text.length) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current)
    }
  }, [text, charsPerTick])

  return text.slice(0, count)
}
