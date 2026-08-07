import { useTranslation } from 'react-i18next'
import { SERIES, DANGER } from '../charts/theme'
import type { BAContent, BAPorterForce } from '../../types'

// Force intensity is pressure AGAINST you: high = danger, medium = tan, low = emerald.
const LEVEL_META: Record<BAPorterForce['level'], { color: string; segments: number }> = {
  low: { color: SERIES[0], segments: 1 },
  medium: { color: SERIES[3], segments: 2 },
  high: { color: DANGER, segments: 3 },
}

export function PorterForces({ content }: { content: BAContent }) {
  const { t } = useTranslation()
  const forces = content.forces ?? []
  return (
    <div className="flex flex-col gap-3" data-testid="porter-forces">
      {forces.map((f) => {
        const meta = LEVEL_META[f.level] ?? LEVEL_META.medium
        return (
          <section key={f.key} className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-bold text-ink">
                {t(`baStudio.force_${f.key}`)}
              </h3>
              <span className="flex items-center gap-1.5">
                <span className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-6 rounded-full"
                      style={{
                        background: i < meta.segments ? meta.color : 'rgb(var(--line))',
                      }}
                    />
                  ))}
                </span>
                {/* Ink, not meta.color: as text in light mode every level fails
                    AA — high/danger 2.72, medium/tan 2.13, low/emerald 3.07 —
                    and swapping only `high` for a token would leave the other
                    two failing.
                    What carries the level is THIS TEXT, which names it outright.
                    The meter is reinforcement only, and deliberately described
                    that way rather than as the color's new home: measured in
                    light mode a filled segment reads just 1.83–2.64:1 against an
                    unfilled one (2.13–3.07 against the card), i.e. under the 3:1
                    non-text floor, which is also why it is aria-hidden. Dark mode
                    is fine at 3.95–5.04. Raising the meter means repainting the
                    shared palette — the same decision the axis-label ticket
                    holds — so it is left alone rather than half-fixed here. */}
                <span className="text-xs font-medium text-ink-soft">
                  {t(`baStudio.level_${f.level}`)}
                </span>
              </span>
            </div>
            {f.rationale && <p className="mt-1.5 text-sm text-ink-soft">{f.rationale}</p>}
          </section>
        )
      })}
    </div>
  )
}
