import { AlertTriangle, Check, ShieldCheck } from 'lucide-react'
import type { SignificanceResult } from '../../types'

/** Statistical guard: trust checks on a result (sample size, real differences,
 *  spurious correlations). Pure presentation. */
export function StatsGuardPanel({ result }: { result: SignificanceResult }) {
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck size={15} className="text-accent" />
        <p className="eyebrow text-ink-soft">Etibarlılıq yoxlaması · {result.summary}</p>
      </div>
      <ul className="space-y-1.5">
        {result.checks.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ${
                c.passed ? 'bg-accent-soft text-accent' : 'bg-[#D87C6B]/15 text-[#D87C6B]'
              }`}
            >
              {c.passed ? <Check size={13} /> : <AlertTriangle size={13} />}
            </span>
            <span className="min-w-0">
              <span className="font-medium text-ink">{c.name}</span>
              <span className="text-ink-soft"> — {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
