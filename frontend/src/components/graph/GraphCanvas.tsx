import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, Crosshair, Maximize2, Search, ZoomIn, ZoomOut } from 'lucide-react'
import { ForceGraph, GLYPH, TYPE_ICON, type GraphHandle } from './ForceGraph'
import { GRAPH_TYPE_COLORS } from '../charts/theme'
import { selectedNode } from '../../store/graphStore'
import type { GraphData, GraphNodeType } from '../../types'

const NODE_ROUTE: Record<GraphNodeType, string> = {
  ds: '/sources',
  table: '/sources',
  metric: '/metrics',
  mnode: '/twin', // the metric-tree editor now lives inside the Digital Twin
  dash: '/dashboards',
  widget: '/dashboards',
  squery: '/reports',
  decision: '/decisions',
}

const LEGEND = Object.keys(GRAPH_TYPE_COLORS) as GraphNodeType[]

// One wheel tick zooms 9.6% (see ForceGraph); the buttons take a coarser 24%
// step — deliberately larger than the wheel, but 20% gentler than the old 30%.
const ZOOM_STEP = 1.24

interface Props {
  data: GraphData
  selectedId: string | null
  highlight: Set<string> | null
  impactMode: boolean
  hiddenTypes: Set<GraphNodeType>
  onSelect: (id: string | null) => void
  onToggleImpact: () => void
  onToggleType: (type: GraphNodeType) => void
  /** Sizing class for the graph <svg>: omit for the default inline card height,
   *  pass a flex-fill class in fullscreen. Falls back to ForceGraph's default. */
  svgClassName?: string
  /** Fullscreen open/close control rendered at the end of the toolbar. */
  toolbarExtra?: ReactNode
  /** Called before navigating away from the detail card (used to exit fullscreen). */
  onNavigateAway?: () => void
}

/**
 * The full graph surface: toolbar (search · zoom · fit · impact) + ForceGraph +
 * clickable type-filter legend + selected-node detail card. Rendered both inline
 * and inside the fullscreen overlay; each mount owns its zoom view + search box.
 */
export function GraphCanvas({
  data,
  selectedId,
  highlight,
  impactMode,
  hiddenTypes,
  onSelect,
  onToggleImpact,
  onToggleType,
  svgClassName,
  toolbarExtra,
  onNavigateAway,
}: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const graphRef = useRef<GraphHandle>(null)
  const [query, setQuery] = useState('')

  const node = selectedNode(data, selectedId)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return data.nodes.filter(
      (n) => !hiddenTypes.has(n.type) && n.label.toLowerCase().includes(q),
    )
  }, [query, data, hiddenTypes])

  const runSearch = () => {
    if (matches[0]) graphRef.current?.focus(matches[0].id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: search · zoom/fit · impact · fullscreen */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
            placeholder={t('graphPage.search')}
            aria-label={t('graphPage.search')}
            className="w-56 rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          {query.trim() && matches.length === 0 && (
            <span className="absolute left-0 top-full mt-1 text-xs text-ink-faint">
              {t('graphPage.searchEmpty')}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center rounded-xl border border-line bg-surface">
            <button
              type="button"
              onClick={() => graphRef.current?.zoomBy(ZOOM_STEP)}
              aria-label={t('graphPage.zoomOut')}
              title={t('graphPage.zoomOut')}
              className="grid h-9 w-9 place-items-center rounded-l-xl text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              onClick={() => graphRef.current?.zoomBy(1 / ZOOM_STEP)}
              aria-label={t('graphPage.zoomIn')}
              title={t('graphPage.zoomIn')}
              className="grid h-9 w-9 place-items-center border-x border-line text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              onClick={() => graphRef.current?.fit()}
              aria-label={t('graphPage.fit')}
              title={t('graphPage.fit')}
              className="grid h-9 w-9 place-items-center rounded-r-xl text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              <Maximize2 size={16} />
            </button>
          </div>
          <button
            type="button"
            onClick={onToggleImpact}
            aria-pressed={impactMode}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
              impactMode
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line text-ink-soft hover:border-accent hover:text-ink'
            }`}
          >
            <Crosshair size={15} />
            {t('graphPage.impactMode')}
          </button>
          {toolbarExtra}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <ForceGraph
            ref={graphRef}
            data={data}
            selectedId={selectedId}
            highlight={highlight}
            hiddenTypes={hiddenTypes}
            onSelect={onSelect}
            className={svgClassName}
          />

          {/* Clickable legend doubles as a type filter. */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {LEGEND.map((type) => {
              const Icon = TYPE_ICON[type]
              const hidden = hiddenTypes.has(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onToggleType(type)}
                  aria-pressed={!hidden}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    hidden
                      ? 'border-line text-ink-faint opacity-60 line-through'
                      : 'border-line text-ink-soft hover:border-accent hover:text-ink'
                  }`}
                >
                  <span
                    className="grid h-4 w-4 place-items-center rounded-full"
                    style={{ background: GRAPH_TYPE_COLORS[type] }}
                  >
                    <Icon size={10} color={GLYPH} strokeWidth={2.4} />
                  </span>
                  {t(`graphPage.type.${type}`)}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-ink-faint">{t('graphPage.hint')}</p>
        </div>

        {node && (
          <aside className="w-full shrink-0 self-start rounded-2xl border border-line bg-surface p-4 shadow-[0_16px_50px_-28px_rgba(40,32,24,0.4)] lg:w-64">
            <div className="flex items-center gap-2">
              <span
                className="grid h-7 w-7 place-items-center rounded-full"
                style={{ background: GRAPH_TYPE_COLORS[node.type] }}
              >
                {(() => {
                  const Icon = TYPE_ICON[node.type]
                  return <Icon size={15} color={GLYPH} strokeWidth={2.2} />
                })()}
              </span>
              <p className="eyebrow">{t(`graphPage.type.${node.type}`)}</p>
            </div>
            <h2 className="mt-2 break-words font-display text-lg font-bold text-ink">
              {node.label}
            </h2>
            {impactMode && highlight && (
              <p className="mt-2 text-xs text-ink-soft">
                {t('graphPage.impactCount', { count: highlight.size - 1 })}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                onNavigateAway?.()
                navigate(NODE_ROUTE[node.type] ?? '/')
              }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-bg transition hover:bg-accent-press"
            >
              <ArrowUpRight size={14} />
              {t('graphPage.open')}
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}
