import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import type { MLLeaderboardEntry } from '../../types'

/** Every candidate algorithm we tried, ranked, with the winner flagged. Makes the
 *  "best_algo" choice legible instead of a black box — you see what it beat. */
export function Leaderboard({ entries }: { entries: MLLeaderboardEntry[] }) {
  const { t } = useTranslation()
  if (!entries.length) return null
  // Scale bars by the best POSITIVE score (r² can go negative for a bad candidate;
  // an abs() max would shrink the winner's bar to a sliver).
  const max = Math.max(...entries.map((e) => e.score), 0.0001)
  return (
    <div>
      <p className="eyebrow mb-2">{t('automl.leaderboardTitle')}</p>
      <ul className="flex flex-col gap-1">
        {entries.map((e) => (
          <li
            key={e.algo}
            className={`flex items-center gap-3 rounded-lg border-l-2 py-1.5 pl-3 pr-2 ${
              e.is_best ? 'border-accent bg-accent/5' : 'border-transparent'
            }`}
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              {e.is_best && <Trophy size={13} className="shrink-0 text-accent" />}
              <span className={`truncate text-sm ${e.is_best ? 'font-semibold text-ink' : 'text-ink-soft'}`}>
                {t(`automl.algo_${e.algo}`, e.algo)}
              </span>
            </span>
            <span className="h-1.5 w-24 shrink-0 rounded-full bg-line">
              <span
                className="block h-1.5 rounded-full bg-accent"
                style={{ width: `${Math.max(0, (e.score / max) * 100)}%` }}
              />
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-sm text-ink">
              {e.score.toFixed(3)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
