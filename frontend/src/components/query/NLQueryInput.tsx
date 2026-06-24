import { CornerDownLeft } from 'lucide-react'
import { useState } from 'react'

interface Props {
  onSubmit: (q: string) => void
  loading: boolean
}

const EXAMPLES = [
  'Ən çox satan 5 məhsul hansıdır?',
  'Aylıq gəlir trendi necədir?',
  'Regionlar üzrə satış payı',
  'Ölkələrə görə müştəri sayı',
]

export function NLQueryInput({ onSubmit, loading }: Props) {
  const [value, setValue] = useState('')
  const submit = (q?: string) => {
    const text = (q ?? value).trim()
    if (text && !loading) onSubmit(text)
  }

  return (
    <div className="space-y-3">
      <div className="group relative rounded-2xl border border-grid bg-panel shadow-card transition focus-within:border-brand">
        <div className="plot-grid pointer-events-none absolute inset-0 rounded-2xl opacity-40" />
        <div className="relative flex items-center gap-3 px-5 py-4">
          <span className="font-mono text-sm text-signal">›</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Datana sual ver — adi dildə yaz…"
            className="flex-1 bg-transparent text-lg text-ink placeholder:text-muted/70 focus:outline-none"
          />
          <button
            onClick={() => submit()}
            disabled={loading || !value.trim()}
            className="flex items-center gap-2 rounded-xl bg-signal px-4 py-2 text-sm font-semibold text-brand shadow-key transition active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
          >
            Soruş <CornerDownLeft size={15} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setValue(ex)
              submit(ex)
            }}
            disabled={loading}
            className="rounded-full border border-grid bg-panel px-3 py-1.5 text-xs text-muted transition hover:border-brand hover:text-ink disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}
