import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DataStory, Widget } from '../../types'
import { ChartRenderer } from '../charts/LazyChartRenderer'
import { RevealText } from '../charts/RevealText'

interface Props {
  story: DataStory
  widgets: Widget[]
  onClose: () => void
}

/** How long to dwell on a slide before auto-advancing — scales with text. */
function slideMs(narrative: string): number {
  return Math.min(12000, Math.max(3500, narrative.length * 45 + 2200))
}

export function StoryMode({ story, widgets, onClose }: Props) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const slides = story.slides
  const slide = slides[index]
  const last = index >= slides.length - 1

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.max(0, Math.min(slides.length - 1, i + delta)))
    },
    [slides.length],
  )

  // Keyboard: arrows navigate, space toggles play, Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  // Auto-advance while playing; stop on the final slide.
  useEffect(() => {
    if (!playing || last || !slide) return
    const t = setTimeout(() => setIndex((i) => i + 1), slideMs(slide.narrative))
    return () => clearTimeout(t)
  }, [playing, last, slide, index])

  if (!slide) return null
  const chart = slide.widget_id
    ? widgets.find((w) => w.id === slide.widget_id)?.chart ?? null
    : null

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

      {/* Slide body */}
      <div className="relative flex flex-1 items-center justify-center px-6 pb-4">
        <div
          key={index}
          className="reveal flex w-full max-w-5xl flex-col items-center gap-6 text-center"
        >
          <h2 className="font-display text-4xl font-bold leading-tight text-ink md:text-5xl">
            {slide.title}
          </h2>
          {slide.narrative && (
            <RevealText
              key={index}
              text={slide.narrative}
              className="max-w-3xl text-lg leading-relaxed text-ink-soft md:text-xl"
            />
          )}
          {chart && chart.data.length > 0 && (
            <div className="mt-2 h-[42vh] w-full rounded-2xl border border-line bg-surface/80 p-4 shadow-card">
              <ChartRenderer data={chart.data} config={chart.chart_config} height="100%" showLegend />
            </div>
          )}
        </div>
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
              onClick={() => setIndex(i)}
              aria-label={t('storyMode.slide', { n: i + 1 })}
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
