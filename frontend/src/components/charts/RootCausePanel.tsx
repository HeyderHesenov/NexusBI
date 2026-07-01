import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, GitBranch } from 'lucide-react'
import type { RootCauseNode, RootCauseResult } from '../../types'
import { TypewriterText } from './TypewriterText'

const DOWN = '#D87C6B' // coral — matches the app's "negative" accent
const MAX_DEPTH = 6 // bound DOM/recursion against a pathologically deep AI tree

function clampPct(p: number | null): number {
  if (p == null || Number.isNaN(p)) return 0
  return Math.max(0, Math.min(100, Math.abs(p)))
}

/** One node of the decomposition tree; recurses into children. */
function Node({ node, depth }: { node: RootCauseNode; depth: number }) {
  const hasKids = depth < MAX_DEPTH && node.children && node.children.length > 0
  const [open, setOpen] = useState(depth === 0)
  const down = node.direction === 'down'
  const pct = clampPct(node.contribution_pct)

  return (
    <li>
      <div
        className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${
          hasKids ? 'cursor-pointer hover:bg-surface' : ''
        }`}
        onClick={hasKids ? () => setOpen((v) => !v) : undefined}
        style={{ paddingLeft: depth * 14 + 8 }}
      >
        {hasKids ? (
          <ChevronRight
            size={14}
            className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{node.label}</span>
        {/* contribution bar */}
        <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-2 sm:block">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: down ? DOWN : 'rgb(var(--accent))' }}
          />
        </div>
        <span
          className="w-12 shrink-0 text-right font-mono text-xs"
          style={{ color: down ? DOWN : 'rgb(var(--accent))' }}
        >
          {node.contribution_pct != null ? `${node.contribution_pct}%` : '—'}
        </span>
        {node.value != null && (
          <span className="w-16 shrink-0 text-right font-mono text-[11px] text-ink-faint">
            {node.value.toLocaleString('az-AZ')}
          </span>
        )}
      </div>
      {hasKids && open && (
        <ul>
          {node.children.map((c, i) => (
            <Node key={`${c.label}-${i}`} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Interactive hierarchical root-cause ("Why?") decomposition tree. */
export function RootCausePanel({ result }: { result: RootCauseResult }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex items-center gap-2">
        <GitBranch size={15} className="text-accent" />
        <p className="eyebrow text-ink-soft">{t('rootCausePanel.title')}{result.metric ? ` · ${result.metric}` : ''}</p>
      </div>
      {result.summary && (
        <TypewriterText text={result.summary} className="text-sm leading-relaxed text-ink-soft" />
      )}
      {result.drivers.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('rootCausePanel.noDrivers')}</p>
      ) : (
        <ul className="mt-1">
          {result.drivers.map((d, i) => (
            <Node key={`${d.label}-${i}`} node={d} depth={0} />
          ))}
        </ul>
      )}
    </div>
  )
}
