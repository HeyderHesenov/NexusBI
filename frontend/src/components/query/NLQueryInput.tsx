import { ArrowUp } from 'lucide-react'
import { useState } from 'react'

interface Props {
  onSubmit: (q: string) => void
  loading: boolean
  /** Schema-aware examples for the active source; falls back to demo examples. */
  samples?: string[]
}

const DEMO_EXAMPLES = [
  'Ən çox satan 5 məhsul hansıdır?',
  'Aylıq gəlir trendi necədir?',
  'Regionlar üzrə satış payı',
  'Ölkələrə görə müştəri sayı',
]

export function NLQueryInput({ onSubmit, loading, samples }: Props) {
  const examples = samples && samples.length ? samples : DEMO_EXAMPLES
  const [value, setValue] = useState('')
  const submit = (q?: string) => {
    const text = (q ?? value).trim()
    if (text && !loading) onSubmit(text)
  }

  return (
    <div className="space-y-3">
      <div className="group relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition focus-within:border-accent">
        <div className="plot-grid pointer-events-none absolute inset-0" />
        <div className="relative flex items-center gap-3 px-5 py-4">
          <span className="font-mono text-base text-accent">›</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Datana sual ver — adi dildə yaz…"
            className="flex-1 bg-transparent text-lg text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            onClick={() => submit()}
            disabled={loading || !value.trim()}
            aria-label="Soruş"
            className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-bg transition hover:bg-accent-press active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setValue(ex)
              submit(ex)
            }}
            disabled={loading}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-soft transition hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}
