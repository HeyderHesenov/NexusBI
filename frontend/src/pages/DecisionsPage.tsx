import { useEffect, useState } from 'react'
import { Lightbulb, Target, Trash2 } from 'lucide-react'
import { useDecisionStore } from '../store/decisionStore'
import { TypewriterText } from '../components/charts/TypewriterText'
import type { Decision, DecisionStatus } from '../types'

const STATUS: { value: DecisionStatus; label: string }[] = [
  { value: 'open', label: 'Açıq' },
  { value: 'in_progress', label: 'İcrada' },
  { value: 'done', label: 'Bitib' },
]

const STATUS_STYLE: Record<DecisionStatus, string> = {
  open: 'border-line text-ink-soft',
  in_progress: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  done: 'border-accent/40 bg-accent-soft text-accent',
}

export function DecisionsPage() {
  const { items, load, patch, remove } = useDecisionStore()

  useEffect(() => {
    load().catch(() => undefined)
  }, [load])

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <p className="eyebrow">Qərarlar</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">
          Insight → Action → Outcome
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          İnsight-dan qərara, qərardan nəticəyə — analitikanı ölçülən təsirə bağla.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="plot-grid rounded-2xl border border-dashed border-line px-6 py-16 text-center">
          <Target size={22} className="mx-auto text-ink-faint" />
          <p className="mt-2 font-display text-lg text-ink">Hələ qərar yoxdur</p>
          <p className="mt-1 text-sm text-ink-soft">
            “Soruş” səhifəsində nəticədə “Qərara çevir” düyməsini işlət.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((d) => (
            <DecisionCard key={d.id} d={d} onPatch={patch} onRemove={remove} />
          ))}
        </ul>
      )}
    </div>
  )
}

function DecisionCard({
  d,
  onPatch,
  onRemove,
}: {
  d: Decision
  onPatch: (id: string, p: { status?: DecisionStatus; outcome?: string }) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const [outcome, setOutcome] = useState(d.outcome)

  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-ink">{d.title}</p>
        <div className="flex shrink-0 items-center gap-1">
          <select
            value={d.status}
            onChange={(e) => onPatch(d.id, { status: e.target.value as DecisionStatus })}
            className={`rounded-lg border bg-surface-2 px-2 py-1.5 text-xs focus:outline-none ${STATUS_STYLE[d.status]}`}
          >
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={() => onRemove(d.id)}
            title="Sil"
            className="rounded-lg border border-line p-1.5 text-ink-soft transition hover:border-[#D87C6B]/50 hover:text-[#D87C6B]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {d.insight && (
        <div className="mt-2 flex items-start gap-1.5 text-sm text-ink-soft">
          <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" />
          <TypewriterText text={d.insight} />
        </div>
      )}
      {d.action && <p className="mt-1 text-sm text-ink"><span className="text-ink-faint">Addım:</span> {d.action}</p>}

      <div className="mt-3">
        <p className="eyebrow mb-1">Nəticə (outcome)</p>
        <textarea
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onBlur={() => outcome !== d.outcome && onPatch(d.id, { outcome })}
          placeholder="Qərarın nəticəsini yaz…"
          rows={2}
          className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </div>
    </li>
  )
}
