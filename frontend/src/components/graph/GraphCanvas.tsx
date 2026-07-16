import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Download,
  GitFork,
  Maximize2,
  PinOff,
  Route,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { ForceGraph, GLYPH, TYPE_ICON, type GraphHandle } from './ForceGraph'
import { GRAPH_MENU_TRIGGER } from './GraphViewSwitcher'
import { ActionMenu, type ActionMenuItem, type ActionMenuSection } from '../ui/ActionMenu'
import { GRAPH_TYPE_COLORS, HEALTH_COLOR } from '../charts/theme'
import { selectedNode, type ImpactDir } from '../../store/graphStore'
import type { GraphData, GraphNodeType } from '../../types'

const NODE_ROUTE: Record<GraphNodeType, string> = {
  ds: '/sources',
  table: '/sources',
  column: '/sources',
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
  /** Canonical keys of the edges on the current path (path mode) — drawn active. */
  pathEdgeKeys: Set<string> | null
  impactMode: boolean
  impactDir: ImpactDir
  pathMode: boolean
  /** Both path endpoints picked. */
  pathActive: boolean
  /** Node count on the found path, or null when the picks are disconnected. */
  pathLength: number | null
  hiddenTypes: Set<GraphNodeType>
  hiddenKinds: Set<string>
  unhealthyOnly: boolean
  onSelect: (id: string | null) => void
  onToggleImpact: () => void
  onSetImpactDir: (dir: ImpactDir) => void
  onTogglePathMode: () => void
  onClearPath: () => void
  onToggleUnhealthy: () => void
  onToggleType: (type: GraphNodeType) => void
  onToggleKind: (kind: string) => void
  /** Sizing class for the graph <svg>: omit for the default inline card height,
   *  pass a flex-fill class in fullscreen. Falls back to ForceGraph's default. */
  svgClassName?: string
  /** Fullscreen open/close control rendered at the end of the toolbar. */
  toolbarExtra?: ReactNode
  /** View switcher rendered at the start of the toolbar. */
  viewSwitcher?: ReactNode
  /** Right-click handlers threaded to ForceGraph (graph-view editing). */
  onNodeContextMenu?: (id: string, e: React.MouseEvent) => void
  onEdgeContextMenu?: (
    edge: { source: string; target: string; kind: string },
    e: React.MouseEvent,
  ) => void
  onCanvasContextMenu?: (e: React.MouseEvent) => void
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
  pathEdgeKeys,
  impactMode,
  impactDir,
  pathMode,
  pathActive,
  pathLength,
  hiddenTypes,
  hiddenKinds,
  unhealthyOnly,
  onSelect,
  onToggleImpact,
  onSetImpactDir,
  onTogglePathMode,
  onClearPath,
  onToggleUnhealthy,
  onToggleType,
  onToggleKind,
  svgClassName,
  toolbarExtra,
  viewSwitcher,
  onNodeContextMenu,
  onEdgeContextMenu,
  onCanvasContextMenu,
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

  // Edge kinds actually present → the edge-kind toggles inside the options menu.
  const edgeKinds = useMemo(
    () => [...new Set(data.edges.map((e) => e.kind))].sort(),
    [data],
  )

  // Secondary controls (filters + export + layout) collapse into one menu so the
  // toolbar keeps only the high-frequency actions. Badge = active filters.
  const activeFilterCount = (unhealthyOnly ? 1 : 0) + hiddenKinds.size
  const optionsSections: ActionMenuSection[] = [
    {
      header: t('graphPage.options.filters'),
      items: [
        {
          key: 'unhealthy',
          label: t('graphPage.unhealthyOnly'),
          Icon: ShieldAlert,
          active: unhealthyOnly,
          keepOpen: true,
          onSelect: onToggleUnhealthy,
        },
        ...edgeKinds.map(
          (kind): ActionMenuItem => ({
            key: `edge-${kind}`,
            label: t(`graphPage.kind.${kind}`, kind),
            active: !hiddenKinds.has(kind),
            keepOpen: true,
            onSelect: () => onToggleKind(kind),
          }),
        ),
      ],
    },
    {
      header: t('graphPage.options.export'),
      items: [
        {
          key: 'png',
          label: t('graphPage.exportPng'),
          Icon: Download,
          onSelect: () => graphRef.current?.exportImage('png'),
        },
        {
          key: 'svg',
          label: t('graphPage.exportSvg'),
          Icon: Download,
          onSelect: () => graphRef.current?.exportImage('svg'),
        },
      ],
    },
    {
      header: t('graphPage.options.layout'),
      items: [
        {
          key: 'reset',
          label: t('graphPage.resetLayout'),
          Icon: PinOff,
          onSelect: () => graphRef.current?.resetPins(),
        },
      ],
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: [ views · search ]  ·····  [ zoom · analyze · options · fullscreen ] */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {viewSwitcher}
        <div className="h-6 w-px shrink-0 self-center bg-line" aria-hidden />
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
            className="h-9 w-56 rounded-xl border border-line bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          />
          {query.trim() && matches.length === 0 && (
            <span className="absolute left-0 top-full mt-1 text-xs text-ink-faint">
              {t('graphPage.searchEmpty')}
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Zoom / fit */}
          <div className="flex h-9 items-center rounded-xl border border-line bg-surface">
            <button
              type="button"
              onClick={() => graphRef.current?.zoomBy(ZOOM_STEP)}
              aria-label={t('graphPage.zoomOut')}
              title={t('graphPage.zoomOut')}
              className="grid h-full w-9 place-items-center rounded-l-xl text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              onClick={() => graphRef.current?.zoomBy(1 / ZOOM_STEP)}
              aria-label={t('graphPage.zoomIn')}
              title={t('graphPage.zoomIn')}
              className="grid h-full w-9 place-items-center border-x border-line text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              onClick={() => graphRef.current?.fit()}
              aria-label={t('graphPage.fit')}
              title={t('graphPage.fit')}
              className="grid h-full w-9 place-items-center rounded-r-xl text-ink-soft transition hover:bg-surface-2 hover:text-ink"
            >
              <Maximize2 size={16} />
            </button>
          </div>

          {/* Analysis: Impact | Path (mutually exclusive) */}
          <div className="flex h-9 items-center rounded-xl border border-line bg-surface">
            <button
              type="button"
              onClick={onToggleImpact}
              aria-pressed={impactMode}
              className={`inline-flex h-full items-center gap-1.5 rounded-l-xl border-r border-line px-3 text-sm font-medium transition ${
                impactMode ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <Crosshair size={15} />
              {t('graphPage.impactMode')}
            </button>
            <button
              type="button"
              onClick={onTogglePathMode}
              aria-pressed={pathMode}
              className={`inline-flex h-full items-center gap-1.5 rounded-r-xl px-3 text-sm font-medium transition ${
                pathMode ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
              }`}
            >
              <Route size={15} />
              {t('graphPage.pathMode')}
            </button>
          </div>

          {/* Impact direction — only while impact mode is on */}
          {impactMode && (
            <div className="flex h-9 items-center rounded-xl border border-line bg-surface">
              {(
                [
                  ['down', ArrowDownRight],
                  ['both', GitFork],
                  ['up', ArrowUpRight],
                ] as const
              ).map(([dir, Icon], i) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => onSetImpactDir(dir)}
                  aria-pressed={impactDir === dir}
                  title={t(`graphPage.impactDir.${dir}`)}
                  aria-label={t(`graphPage.impactDir.${dir}`)}
                  className={`grid h-full w-9 place-items-center transition ${
                    i === 0 ? 'rounded-l-xl' : i === 2 ? 'rounded-r-xl' : 'border-x border-line'
                  } ${
                    impactDir === dir
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-soft hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          )}

          {/* Options: filters · export · layout */}
          <ActionMenu
            triggerLabel={t('graphPage.options.label')}
            triggerIcon={SlidersHorizontal}
            ariaLabel={t('graphPage.options.label')}
            triggerClassName={GRAPH_MENU_TRIGGER}
            count={activeFilterCount}
            sections={optionsSections}
          />

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
            pathEdgeKeys={pathEdgeKeys}
            hiddenTypes={hiddenTypes}
            hiddenKinds={hiddenKinds}
            unhealthyOnly={unhealthyOnly}
            onSelect={onSelect}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onCanvasContextMenu={onCanvasContextMenu}
            className={svgClassName}
          />

          {/* Color key doubling as a type filter (edge-kind filters live in the
              options menu). */}
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

          <p className="mt-2 text-xs text-ink-faint">
            {pathMode ? t('graphPage.pathHint') : t('graphPage.hint')}
          </p>
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
            {node.status && node.reason && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-soft">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: HEALTH_COLOR[node.status] }}
                />
                {t(`graphPage.health.${node.reason}`)}
              </p>
            )}
            {impactMode && highlight && (
              <p className="mt-2 text-xs text-ink-soft">
                {t(impactDir === 'up' ? 'graphPage.upstreamCount' : 'graphPage.impactCount', {
                  count: highlight.size - 1,
                })}
              </p>
            )}
            {pathActive && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-xs text-ink-soft">
                  {pathLength != null
                    ? t('graphPage.pathLength', { count: pathLength })
                    : t('graphPage.pathNone')}
                </p>
                <button
                  type="button"
                  onClick={onClearPath}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink-soft transition hover:text-accent"
                >
                  <X size={13} />
                  {t('graphPage.pathClear')}
                </button>
              </div>
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
