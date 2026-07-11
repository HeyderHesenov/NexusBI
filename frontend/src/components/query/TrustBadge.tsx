import { Code2, Shield, ShieldAlert, ShieldCheck, Sigma, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Provenance } from '../../types'

/** Compact answer-trust chip: turns the pipeline's provenance + confidence (which
 *  the backend used to drop) into an honest signal a non-SQL user can read at a
 *  glance. Renders nothing for legacy rows (provenance null). */
export function TrustBadge({
  provenance,
  confidence,
}: {
  provenance?: Provenance | null
  confidence?: number | null
}) {
  const { t } = useTranslation()
  if (!provenance) return null

  const b = badgeFor(provenance, confidence)
  return (
    <span
      title={t(b.tip)}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${b.cls}`}
    >
      {b.icon}
      <span>{t(b.label)}</span>
    </span>
  )
}

type Badge = { label: string; tip: string; cls: string; icon: JSX.Element }

const ICON = 'shrink-0'

function badgeFor(provenance: Provenance, confidence?: number | null): Badge {
  switch (provenance) {
    case 'deterministic_fallback':
      // AI offline → the SQL came from a deterministic rule, not an LLM guess.
      return {
        label: 'trust.deterministic',
        tip: 'trust.tip.deterministic',
        cls: 'border-line bg-surface-2 text-ink-soft',
        icon: <Sigma size={12} className={`${ICON} text-ink-faint`} />,
      }
    case 'self_repaired':
      return {
        label: 'trust.repaired',
        tip: 'trust.tip.repaired',
        cls: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
        icon: <Wrench size={12} className={`${ICON} text-amber-500`} />,
      }
    case 'user_sql':
      return {
        label: 'trust.exact',
        tip: 'trust.tip.exact',
        cls: 'border-line bg-surface-2 text-ink-soft',
        icon: <Code2 size={12} className={`${ICON} text-ink-faint`} />,
      }
    case 'llm':
    default:
      return llmBadge(confidence)
  }
}

function llmBadge(confidence?: number | null): Badge {
  const c = typeof confidence === 'number' ? confidence : 0.5
  if (c >= 0.66) {
    return {
      label: 'trust.high',
      tip: 'trust.tip.high',
      cls: 'border-accent/40 bg-accent-soft text-accent',
      icon: <ShieldCheck size={12} className={`${ICON} text-accent`} />,
    }
  }
  if (c >= 0.4) {
    return {
      label: 'trust.medium',
      tip: 'trust.tip.medium',
      cls: 'border-line bg-surface-2 text-ink-soft',
      icon: <Shield size={12} className={`${ICON} text-ink-faint`} />,
    }
  }
  return {
    label: 'trust.low',
    tip: 'trust.tip.low',
    cls: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    icon: <ShieldAlert size={12} className={`${ICON} text-amber-500`} />,
  }
}
