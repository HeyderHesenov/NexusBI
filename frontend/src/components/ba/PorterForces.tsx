import { useTranslation } from 'react-i18next'
import { useChartTheme, type ChartTheme } from '../charts/theme'
import type { BAContent, BAPorterForce } from '../../types'

/** How many of the three segments a level fills. Mode-independent. */
const LEVEL_SEGMENTS: Record<BAPorterForce['level'], number> = { low: 1, medium: 2, high: 3 }

// Force intensity is pressure AGAINST you: high = danger, medium = tan, low = emerald.
// Built from the theme rather than at module scope, because the palette is now
// per-mode — a module constant would freeze whichever mode loaded first.
function levelMeta(theme: ChartTheme, level: BAPorterForce['level']) {
  const color = { low: theme.SERIES[0], medium: theme.SERIES[3], high: theme.DANGER }[level]
  return { color, segments: LEVEL_SEGMENTS[level] }
}

export function PorterForces({ content }: { content: BAContent }) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  const forces = content.forces ?? []
  return (
    <div className="flex flex-col gap-3" data-testid="porter-forces">
      {forces.map((f) => {
        // Membership, not truthiness — the fallback is for a level the backend
        // invents. `LEVEL_SEGMENTS[f.level] ?` reads the segment COUNT, so a
        // plausible `none: 0` would be silently rewritten to `medium`: two tan
        // segments under a label still reading `level_none`, and nothing to fail.
        const meta = levelMeta(theme, f.level in LEVEL_SEGMENTS ? f.level : 'medium')
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
                {/* Ink, not meta.color. This used to be forced: as text in light
                    mode every level failed AA (2.13–3.07). The per-mode palette
                    closed that — measured on this card (`--surface-2`) the three
                    now read 5.06 / 7.90 / 5.69 — so it stays ink by choice, not
                    by constraint: the label is one item in a column of labels and
                    should not change colour to say what the word already says.
                    What carries the level is THIS TEXT, which names it outright.
                    The meter is reinforcement, and aria-hidden because the text
                    beside it already announces the level — duplication, not
                    contrast. The contrast argument this comment used to make is
                    also spent: a filled segment now reads 4.34–6.78 against an
                    unfilled one where it read 1.83–2.64, clearing the 3:1
                    non-text floor it used to sit under. The repaint it deferred
                    to is the commit it is standing in. */}
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
