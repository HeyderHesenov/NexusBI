import { Info, Workflow } from 'lucide-react'
import type { CausalResult } from '../../types'

/** Driver analysis: which numeric columns correlate with the target metric.
 *  Pure presentation — bars scale with |r|, significant drivers accented. */
export function CausalPanel({ result }: { result: CausalResult }) {
  const drivers = result.drivers.slice(0, 8)
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        <Workflow size={15} className="text-accent" />
        <p className="eyebrow text-ink-soft">
          Səbəb analizi{result.target ? ` · ${result.target}` : ''}
        </p>
      </div>
      {result.summary && <p className="text-sm leading-relaxed text-ink-soft">{result.summary}</p>}

      {drivers.length > 0 && (
        <ul className="space-y-1.5 pt-1">
          {drivers.map((d) => (
            <li key={d.feature} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-ink">{d.feature}</span>
                <span className="shrink-0 font-mono text-xs text-ink-soft">
                  r={d.r} · {d.direction}
                  {d.significant ? '' : ' · əhəmiyyətsiz'}
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className={d.significant ? 'h-full rounded-full bg-accent' : 'h-full rounded-full bg-ink-faint'}
                  style={{ width: `${Math.min(100, Math.abs(d.r) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {result.caveats.length > 0 && (
        <ul className="space-y-1 pt-1.5">
          {result.caveats.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-ink-faint">
              <Info size={12} className="mt-0.5 shrink-0" /> {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
