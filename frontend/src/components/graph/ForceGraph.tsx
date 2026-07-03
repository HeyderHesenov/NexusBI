import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Table,
  type LucideProps,
} from 'lucide-react'
import { truncateLabel } from '../../lib/format'
import { neighborSet } from '../../store/graphStore'
import type { GraphData, GraphNode, GraphNodeType } from '../../types'
import { GRAPH_TYPE_COLORS, useChartTheme } from '../charts/theme'
import { LAYOUT_H, LAYOUT_W, useForceLayout } from './useForceLayout'

interface Props {
  data: GraphData
  selectedId: string | null
  /** Nodes to highlight (impact mode); null = highlight everything. */
  highlight: Set<string> | null
  /** Types the user filtered out via the legend — hidden from the canvas. */
  hiddenTypes: Set<GraphNodeType>
  onSelect: (id: string | null) => void
}

/** Imperative controls the toolbar drives (zoom buttons, fit, search-to-focus). */
export interface GraphHandle {
  zoomBy: (factor: number) => void
  fit: () => void
  focus: (id: string) => void
}

export const TYPE_ICON: Record<GraphNodeType, ComponentType<LucideProps>> = {
  ds: Database,
  table: Table,
  metric: Gauge,
  mnode: GitBranch,
  dash: LayoutDashboard,
  widget: BarChart3,
  squery: FileText,
  decision: CheckCircle2,
}

// Radius carries real hierarchy: sources and dashboards read as hubs, leaves
// stay small. (Old range was a barely-legible 9–14.)
const TYPE_RADIUS: Record<GraphNodeType, number> = {
  ds: 24, dash: 22, table: 18, decision: 18, metric: 16, mnode: 15, squery: 14, widget: 13,
}
const DEFAULT_RADIUS = 12

// Dark glyph sits on every node color at ≥3:1 contrast on both themes.
export const GLYPH = '#1B1A18'

// Approx px per character at the tooltip's 11.5px label — used to size the
// backing rect without a DOM text measurement (constant, deterministic).
const TIP_CHAR_PX = 6.6

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4

const clampW = (w: number) => Math.min(Math.max(w, LAYOUT_W / MAX_ZOOM), LAYOUT_W / MIN_ZOOM)

/**
 * Interactive SVG knowledge graph: wheel/button zoom, drag-pan, click-select,
 * hover neighbor-emphasis + tooltip, directional curved edges, type filtering.
 */
export const ForceGraph = forwardRef<GraphHandle, Props>(function ForceGraph(
  { data, selectedId, highlight, hiddenTypes, onSelect },
  ref,
) {
  const { t } = useTranslation()
  const theme = useChartTheme()
  // Lay out every node once so positions stay stable while types are filtered.
  const nodeIds = useMemo(() => data.nodes.map((n) => n.id), [data])
  const layout = useForceLayout(nodeIds, data.edges)
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, w: LAYOUT_W, h: LAYOUT_H })
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const drag = useRef<{ startX: number; startY: number; view: typeof view; moved: boolean } | null>(null)

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) =>
      setView((v) => {
        const w = clampW(v.w * factor)
        const h = (w / LAYOUT_W) * LAYOUT_H
        const cx = v.x + v.w / 2
        const cy = v.y + v.h / 2
        return { x: cx - w / 2, y: cy - h / 2, w, h }
      }),
    fit: () => setView({ x: 0, y: 0, w: LAYOUT_W, h: LAYOUT_H }),
    focus: (id) => {
      const p = layout.get(id)
      if (!p) return
      const w = clampW(LAYOUT_W / 2.2)
      const h = (w / LAYOUT_W) * LAYOUT_H
      setView({ x: p.x - w / 2, y: p.y - h / 2, w, h })
      onSelect(id)
    },
  }))

  // Plain wheel must zoom the canvas, so the listener has to be non-passive
  // (React's onWheel is passive → preventDefault would be ignored).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
        const w = clampW(v.w * factor)
        const h = (w / LAYOUT_W) * LAYOUT_H
        const rect = svg.getBoundingClientRect()
        const px = (e.clientX - rect.left) / rect.width
        const py = (e.clientY - rect.top) / rect.height
        return { x: v.x + (v.w - w) * px, y: v.y + (v.h - h) * py, w, h }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // NO setPointerCapture here: capturing on the svg retargets the following
  // pointerup to the svg itself, so the per-node <g> onPointerUp would never
  // fire in a real browser and nodes would become unselectable.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    drag.current = { startX: e.clientX, startY: e.clientY, view, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    // Only pan while the primary button is held — a lost pointerup (e.g.
    // released outside the svg) must not leave the canvas following the mouse.
    if (!d || (e.buttons & 1) === 0) {
      drag.current = null
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = ((e.clientX - d.startX) / rect.width) * d.view.w
    const dy = ((e.clientY - d.startY) / rect.height) * d.view.h
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) d.moved = true
    setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy })
  }
  const onPointerUp = () => {
    const wasDrag = drag.current?.moved
    drag.current = null
    if (!wasDrag) onSelect(null) // click on empty canvas clears the selection
  }
  const onPointerCancel = () => {
    drag.current = null
  }

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>()
    for (const n of data.nodes) m.set(n.id, n)
    return m
  }, [data])
  const radiusOf = (id: string) =>
    TYPE_RADIUS[nodeById.get(id)?.type ?? 'widget'] ?? DEFAULT_RADIUS

  const visible = useMemo(
    () => data.nodes.filter((n) => !hiddenTypes.has(n.type)),
    [data, hiddenTypes],
  )
  const visibleIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible])

  // Only honor a hover whose node is still on the canvas — a node filtered out
  // by the legend unmounts without firing pointer-leave, so hoveredId can go
  // stale; gating here avoids a tooltip/dim for an invisible node.
  const hoverId = hoveredId && visibleIds.has(hoveredId) ? hoveredId : null
  const hoverSet = useMemo(
    () => (hoverId ? neighborSet(data, hoverId) : null),
    [data, hoverId],
  )

  // Edge geometry (curve, trimmed endpoints, control point) depends only on
  // layout + radii, never on view/hover/selection — memoize so panning
  // (setView at ~60fps) doesn't re-run trig for every edge each frame.
  const edgeGeom = useMemo(
    () =>
      data.edges.map((e) => {
        const a = layout.get(e.source)
        const b = layout.get(e.target)
        if (!a || !b) return null
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.hypot(dx, dy) || 1
        const ux = dx / dist
        const uy = dy / dist
        const rS = radiusOf(e.source)
        const rT = radiusOf(e.target)
        const sx = a.x + ux * (rS + 2)
        const sy = a.y + uy * (rS + 2)
        const ex = b.x - ux * (rT + 8)
        const ey = b.y - uy * (rT + 8)
        // Gentle quadratic bow (perpendicular offset) declutters parallel links.
        const curve = Math.min(dist * 0.12, 46)
        const cxp = (sx + ex) / 2 - uy * curve
        const cyp = (sy + ey) / 2 + ux * curve
        return {
          source: e.source,
          target: e.target,
          kind: e.kind,
          d: `M${sx},${sy} Q${cxp},${cyp} ${ex},${ey}`,
          cxp,
          cyp,
        }
      }),
    [data, layout, nodeById],
  )

  // Dim precedence: hover neighbors win, then impact-mode highlight.
  const dim = (id: string) => {
    if (hoverSet) return !hoverSet.has(id)
    if (highlight) return !highlight.has(id)
    return false
  }
  const edgeActive = (source: string, target: string) => {
    if (hoverId) return source === hoverId || target === hoverId
    if (selectedId) return source === selectedId || target === selectedId
    return false
  }

  const zoom = LAYOUT_W / view.w // 1 = fit; >1 zoomed in; <1 zoomed out
  const tipScale = view.w / LAYOUT_W // keeps the in-SVG tooltip a constant on-screen size

  const hovered = hoverId ? layout.get(hoverId) : null
  const hoveredNode = hoverId ? nodeById.get(hoverId) : null

  return (
    <svg
      ref={svgRef}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="h-[560px] w-full cursor-grab touch-none select-none rounded-2xl border border-line bg-surface shadow-[0_16px_50px_-24px_rgba(40,32,24,0.45)] active:cursor-grabbing"
      data-testid="force-graph"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        onPointerCancel()
        setHoveredId(null)
      }}
    >
      <defs>
        <pattern id="graph-dots" width={26} height={26} patternUnits="userSpaceOnUse">
          <circle cx={1.5} cy={1.5} r={1.1} fill={theme.GRID} opacity={0.55} />
        </pattern>
        <marker
          id="graph-arrow"
          markerWidth={9}
          markerHeight={9}
          refX={7}
          refY={4}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill={theme.EDGE} />
        </marker>
        <marker
          id="graph-arrow-active"
          markerWidth={10}
          markerHeight={10}
          refX={7.5}
          refY={4.5}
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L9,4.5 L0,9 Z" fill={theme.ACCENT} />
        </marker>
      </defs>

      {/* Dotted canvas — userSpaceOnUse ties dots to world coords so they pan
          and zoom with the graph, giving depth without stealing focus. */}
      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#graph-dots)" pointerEvents="none" />

      {edgeGeom.map((g, i) => {
        if (!g) return null
        if (!visibleIds.has(g.source) || !visibleIds.has(g.target)) return null
        const dimmed = dim(g.source) || dim(g.target)
        const active = !dimmed && edgeActive(g.source, g.target)
        return (
          <g key={i}>
            <path
              d={g.d}
              fill="none"
              stroke={active ? theme.ACCENT : theme.EDGE}
              strokeWidth={active ? 2 : dimmed ? 0.7 : 1.4}
              opacity={dimmed ? 0.28 : active ? 0.95 : 0.75}
              markerEnd={active ? 'url(#graph-arrow-active)' : 'url(#graph-arrow)'}
            />
            {active && (
              <text
                x={g.cxp}
                y={g.cyp}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={10}
                fill={theme.ACCENT}
                stroke={theme.SURFACE}
                strokeWidth={3}
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >
                {t(`graphPage.kind.${g.kind}`, g.kind)}
              </text>
            )}
          </g>
        )
      })}

      {visible.map((n) => {
        const p = layout.get(n.id)
        if (!p) return null
        const dimmed = dim(n.id)
        const r = TYPE_RADIUS[n.type] ?? DEFAULT_RADIUS
        const isz = Math.round(r * 1.05)
        const Icon = TYPE_ICON[n.type] ?? Gauge
        const color = GRAPH_TYPE_COLORS[n.type] ?? theme.ACCENT
        const isSelected = n.id === selectedId
        const isHovered = n.id === hoverId
        const emphasized = isSelected || (!!hoverSet && hoverSet.has(n.id))
        const showLabel = emphasized || zoom >= 0.8 || r >= 20
        return (
          <g
            key={n.id}
            transform={`translate(${p.x},${p.y})`}
            opacity={dimmed ? 0.2 : 1}
            className="cursor-pointer"
            data-node-id={n.id}
            onPointerEnter={() => {
              // Skip while panning — the cursor sweeping over nodes mid-drag
              // must not fire hover emphasis/tooltip flicker.
              if (!drag.current) setHoveredId(n.id)
            }}
            onPointerLeave={() => setHoveredId((cur) => (cur === n.id ? null : cur))}
            onPointerUp={(e) => {
              if (!drag.current?.moved) {
                e.stopPropagation()
                drag.current = null
                onSelect(n.id)
              }
            }}
          >
            {emphasized && <circle r={r + 9} fill={color} opacity={0.18} style={{ pointerEvents: 'none' }} />}
            <circle
              r={r}
              fill={color}
              stroke={isSelected || isHovered ? theme.ACCENT : theme.SURFACE}
              strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 2}
            />
            <Icon
              x={-isz / 2}
              y={-isz / 2}
              width={isz}
              height={isz}
              color={GLYPH}
              strokeWidth={2.2}
              style={{ pointerEvents: 'none' }}
            />
            {showLabel && (
              <text
                y={r + 14}
                textAnchor="middle"
                fontSize={11}
                fill={theme.INK_SOFT}
                stroke={theme.SURFACE}
                strokeWidth={3}
                paintOrder="stroke"
                style={{ pointerEvents: 'none' }}
              >
                {truncateLabel(n.label, 22)}
              </text>
            )}
          </g>
        )
      })}

      {/* Tooltip: drawn in SVG but counter-scaled so its on-screen size is
          constant regardless of zoom. */}
      {hovered && hoveredNode && (() => {
        const label = hoveredNode.label
        const typeLabel = t(`graphPage.type.${hoveredNode.type}`)
        const chars = Math.max(label.length, typeLabel.length + 2)
        const w = (chars * TIP_CHAR_PX + 24) * tipScale
        const h = 42 * tipScale
        const r = TYPE_RADIUS[hoveredNode.type] ?? DEFAULT_RADIUS
        return (
          <g transform={`translate(${hovered.x},${hovered.y - (r + 6)})`} style={{ pointerEvents: 'none' }}>
            <rect
              x={-w / 2}
              y={-h}
              width={w}
              height={h}
              rx={8 * tipScale}
              fill={theme.SURFACE}
              stroke={theme.GRID}
              strokeWidth={tipScale}
            />
            <text
              x={0}
              y={-h + 15 * tipScale}
              textAnchor="middle"
              fontSize={9 * tipScale}
              fill={GRAPH_TYPE_COLORS[hoveredNode.type] ?? theme.ACCENT}
              fontWeight={600}
              letterSpacing={0.4 * tipScale}
            >
              {typeLabel.toUpperCase()}
            </text>
            <text
              x={0}
              y={-h + 31 * tipScale}
              textAnchor="middle"
              fontSize={11.5 * tipScale}
              fill={theme.INK_SOFT}
              fontWeight={500}
            >
              {truncateLabel(label, 30)}
            </text>
          </g>
        )
      })()}
    </svg>
  )
})
