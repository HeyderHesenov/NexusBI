import { useTranslation } from 'react-i18next'
import { SERIES, DANGER } from '../charts/theme'
import type { BAContent } from '../../types'

const ACCENT = SERIES[0]

/** Quadrant order is the canonical SWOT reading order: S | W / O | T. */
const QUADS = [
  { key: 'strengths', color: ACCENT },
  { key: 'weaknesses', color: DANGER },
  { key: 'opportunities', color: SERIES[2] }, // dusty blue
  { key: 'threats', color: SERIES[3] }, // tan
] as const

export function SWOTGrid({ content }: { content: BAContent }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="swot-grid">
      {QUADS.map(({ key, color }) => {
        const items = content[key] ?? []
        return (
          <section key={key} className="rounded-2xl border border-line bg-surface-2 p-4">
            {/* Heading text stays on the ink token for contrast; the dot carries the color. */}
            <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-bold text-ink">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {t(`baStudio.${key}`)}
            </h3>
            {items.length === 0 ? (
              <p className="text-xs text-ink-faint">{t('baStudio.quadrantEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-sm text-ink-soft">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
