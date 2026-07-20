import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DataStory, Widget } from '../../types'
import { ChartRenderer } from '../charts/LazyChartRenderer'

interface Props {
  story: DataStory
  widgets: Widget[]
  onClose: () => void
}

/** How long to dwell on a slide before auto-advancing — scales with text. */
function slideMs(narrative: string): number {
  return Math.min(12000, Math.max(3500, narrative.length * 45 + 2200))
}

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function StoryMode({ story, widgets, onClose }: Props) {
  const { t } = useTranslation()
  const slides = story.slides
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  // Which slides have scrolled into view — drives the `.deck-rise` reveal.
  // Add-only (permanent once seen) so scrolling back never re-triggers it.
  const [visible, setVisible] = useState<Set<number>>(() => new Set())
  // Which slides' heavy recharts trees have been instantiated (active ±1).
  const [mounted, setMounted] = useState<Set<number>>(() => new Set([0, 1]))
  const scrollRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const ratios = useRef<number[]>([])
  const last = index >= slides.length - 1

  const charts = useMemo(
    () =>
      slides.map((s) =>
        s.widget_id ? (widgets.find((w) => w.id === s.widget_id)?.chart ?? null) : null,
      ),
    [slides, widgets],
  )

  // Single navigation path: scroll position is the source of truth; `index`
  // updates itself via the IntersectionObserver once the scroll settles.
  const scrollToIndex = useCallback(
    (i: number) => {
      const el = scrollRef.current
      if (!el) return
      const target = Math.max(0, Math.min(slides.length - 1, i))
      el.scrollTo({ top: target * el.clientHeight, behavior: prefersReduced() ? 'auto' : 'smooth' })
    },
    [slides.length],
  )
  const go = useCallback((delta: number) => scrollToIndex(index + delta), [index, scrollToIndex])

  // Reveal the first slide one frame after paint (opacity:0 → is-in transition).
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(new Set([0])))
    return () => cancelAnimationFrame(id)
  }, [])

  // Derive the active slide from what's actually on screen: one observer rooted
  // on the scroller, active = the section with the highest intersection ratio.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    ratios.current = slides.map(() => 0)
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.index)
          ratios.current[i] = e.intersectionRatio
        }
        let best = 0
        let bestR = -1
        ratios.current.forEach((r, i) => {
          if (r > bestR) {
            bestR = r
            best = i
          }
        })
        setIndex((cur) => (cur === best ? cur : best))
        setVisible((prev) => {
          let changed = false
          const next = new Set(prev)
          ratios.current.forEach((r, i) => {
            if (r > 0.5 && !next.has(i)) {
              next.add(i)
              changed = true
            }
          })
          return changed ? next : prev
        })
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    sectionRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [slides.length])

  // Pre-mount the active slide's neighbours so their charts paint before arrival.
  useEffect(() => {
    setMounted((prev) => {
      const next = new Set(prev)
      ;[index - 1, index, index + 1].forEach((i) => {
        if (i >= 0 && i < slides.length) next.add(i)
      })
      return next.size === prev.size ? prev : next
    })
  }, [index, slides.length])

  // Keyboard: arrows/page keys scroll, space toggles play, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        go(-1)
      } else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  // Lock background scroll and hold focus while the presentation is open.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    const prevFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    scrollRef.current?.focus?.()
    return () => {
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [])

  // Auto-advance while playing — smoothly scrolls to the next slide; stops last.
  useEffect(() => {
    if (!playing || last) return
    const id = setTimeout(
      () => scrollToIndex(index + 1),
      slideMs(slides[index]?.narrative ?? ''),
    )
    return () => clearTimeout(id)
  }, [playing, last, index, slides, scrollToIndex])

  if (slides.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-60">
        <div className="aurora-blob aurora-1" />
        <div className="aurora-blob aurora-3" />
      </div>

      {/* Top bar */}
      <div className="relative flex items-center justify-between px-6 py-4">
        <span className="eyebrow text-accent">{t('storyMode.dataStory')}</span>
        <button
          onClick={onClose}
          aria-label={t('storyMode.close')}
          className="rounded-full border border-line p-2 text-ink-soft transition hover:border-accent hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      {/* Slide deck — native vertical scroll-snap; the browser owns the smooth
          page-to-page glide, one slide snaps into place per gesture. */}
      <div
        ref={scrollRef}
        tabIndex={-1}
        role="region"
        aria-roledescription="carousel"
        aria-label={story.title}
        className="relative min-h-0 flex-1 snap-y snap-mandatory overflow-y-auto scroll-smooth [scrollbar-width:none] focus:outline-none motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s, i) => {
          const on = visible.has(i) ? 'is-in' : ''
          const chart = charts[i]
          return (
            <section
              key={i}
              data-index={i}
              ref={(el) => {
                sectionRefs.current[i] = el
              }}
              role="group"
              aria-roledescription="slide"
              aria-label={t('storyMode.slide', { n: i + 1 })}
              aria-hidden={i !== index}
              className="flex h-full snap-start snap-always items-center justify-center px-6 pb-4"
            >
              <div className="flex w-full max-w-5xl flex-col items-center gap-6 text-center">
                <h2
                  className={`deck-rise font-display text-4xl font-bold leading-tight text-ink md:text-5xl ${on}`}
                >
                  {s.title}
                </h2>
                {s.narrative && (
                  <p
                    className={`deck-rise max-w-3xl text-lg leading-relaxed text-ink-soft [transition-delay:90ms] md:text-xl ${on}`}
                  >
                    {s.narrative}
                  </p>
                )}
                {chart && chart.data.length > 0 && (
                  <div
                    className={`deck-rise mt-2 h-[42vh] w-full rounded-2xl border border-line bg-surface/80 p-4 shadow-card [transition-delay:170ms] ${on}`}
                  >
                    {mounted.has(i) ? (
                      <ChartRenderer
                        data={chart.data}
                        config={chart.chart_config}
                        height="100%"
                        showLegend
                      />
                    ) : (
                      <div className="h-full w-full" />
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {/* Controls */}
      <div className="relative flex items-center justify-center gap-4 px-6 py-5">
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label={t('storyMode.previous')}
          className="rounded-full border border-line p-2.5 text-ink-soft transition hover:border-accent hover:text-ink disabled:opacity-40"
        >
          <ChevronLeft size={18} />
        </button>

        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? t('storyMode.pause') : t('storyMode.play')}
          className="rounded-full bg-accent p-3 text-bg shadow-card transition hover:bg-accent-press"
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <button
          onClick={() => go(1)}
          disabled={last}
          aria-label={t('storyMode.next')}
          className="rounded-full border border-line p-2.5 text-ink-soft transition hover:border-accent hover:text-ink disabled:opacity-40"
        >
          <ChevronRight size={18} />
        </button>

        <div className="ml-3 flex items-center gap-1.5">
          {slides.map((_s, i) => (
            <button
              key={i}
              onClick={() => scrollToIndex(i)}
              aria-label={t('storyMode.slide', { n: i + 1 })}
              aria-current={i === index || undefined}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-6 bg-accent' : 'w-1.5 bg-line hover:bg-ink-faint'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
