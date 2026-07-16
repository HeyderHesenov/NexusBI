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
  Columns3,
  Database,
  FileText,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Table,
  type LucideProps,
} from 'lucide-react'
import { truncateLabel } from '../../lib/format'
import { neighborSet, pathEdgeKey } from '../../store/graphStore'
import type { GraphData, GraphNode, GraphNodeType } from '../../types'
import { GRAPH_TYPE_COLORS, HEALTH_COLOR, useChartTheme } from '../charts/theme'
import { LAYOUT_H, LAYOUT_W, useForceLayout, type LayoutPoint } from './useForceLayout'
import {
  downloadBlob,
  loadPins,
  mergePositions,
  miniToWorld,
  savePins,
  serializeSvg,
} from './graphView'

interface Props {
  data: GraphData
  selectedId: string | null
  /** Nodes to highlight (impact mode); null = highlight everything. */
  highlight: Set<string> | null
  /** Canonical keys (see pathEdgeKey) of edges on the current path — drawn active. */
  pathEdgeKeys?: Set<string> | null
  /** Types the user filtered out via the legend — hidden from the canvas. */
  hiddenTypes: Set<GraphNodeType>
  /** Edge kinds the user filtered out via the edge legend. */
  hiddenKinds?: Set<string>
  /** Trust filter: show only nodes with a warn/danger/unknown status. */
  unhealthyOnly?: boolean
  /** Show the overview mini-map (default true; off in tests / tiny embeds). */
  showMiniMap?: boolean
  onSelect: (id: string | null) => void
  /** Right-click a node → open a context menu at the cursor position. */
  onNodeContextMenu?: (id: string, e: React.MouseEvent) => void
  /** Right-click an edge → open a context menu at the cursor position. */
  onEdgeContextMenu?: (
    edge: { source: string; target: string; kind: string },
    e: React.MouseEvent,
  ) => void
  /** Right-click empty canvas → open a context menu at the cursor position. */
  onCanvasContextMenu?: (e: React.MouseEvent) => void
  /** Sizing utility for the wrapper (height); default is the inline card height. */
  className?: string
}

/** Imperative controls the toolbar drives (zoom buttons, fit, search-to-focus). */
export interface GraphHandle {
  zoomBy: (factor: number) => void
  fit: () => void
  focus: (id: string) => void
  /** Download the current view as an image. */
  exportImage: (format: 'svg' | 'png') => void
  /** Clear all manually-pinned node positions. */
  resetPins: () => void
}

const MINI_W = 168
const MINI_H = Math.round((MINI_W / LAYOUT_W) * LAYOUT_H)

export const TYPE_ICON: Record<GraphNodeType, ComponentType<LucideProps>> = {
  ds: Database,
  table: Table,
  metric: Gauge,
  mnode: GitBranch,
  dash: LayoutDashboard,
  widget: BarChart3,
  squery: FileText,
  decision: CheckCircle2,
  column: Columns3,
}

// Radius carries real hierarchy: sources and dashboards read as hubs, leaves
// stay small. (Old range was a barely-legible 9–14.)
const TYPE_RADIUS: Record<GraphNodeType, number> = {
  ds: 24, dash: 22, table: 18, decision: 18, metric: 16, mnode: 15, squery: 14, widget: 13,
  column: 10,
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
  {
    data,
    selectedId,
    highlight,
    pathEdgeKeys = null,
    hiddenTypes,
    hiddenKinds,
    unhealthyOnly = false,
    showMiniMap = true,
    onSelect,
    onNodeContextMenu,
    onEdgeContextMenu,
    onCanvasContextMenu,
    className = 'h-[560px]',
  },
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

  // Manual node positions layered over the force layout — persisted by node id.
  const [pinned, setPinned] = useState<Map<string, LayoutPoint>>(() => loadPins())
  const nodeDrag = useRef<{ id: string; startX: number; startY: number; moved: boolean } | null>(null)
  const pos = useMemo(() => mergePositions(layout, pinned), [layout, pinned])
  // Effective positions for use inside imperative callbacks / event handlers.
  const posRef = useRef(pos)
  posRef.current = pos

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
      const p = posRef.current.get(id)
      if (!p) return
      const w = clampW(LAYOUT_W / 2.2)
      const h = (w / LAYOUT_W) * LAYOUT_H
      setView({ x: p.x - w / 2, y: p.y - h / 2, w, h })
      onSelect(id)
    },
    exportImage: (format) => {
      const svg = svgRef.current
      if (!svg) return
      // The canvas background is a CSS class (not serialized) — inject an explicit
      // surface rect so the exported image isn't transparent.
      const clone = svg.cloneNode(true) as SVGSVGElement
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      bg.setAttribute('x', String(view.x))
      bg.setAttribute('y', String(view.y))
      bg.setAttribute('width', String(view.w))
      bg.setAttribute('height', String(view.h))
      bg.setAttribute('fill', theme.SURFACE)
      clone.insertBefore(bg, clone.firstChild)
      const src = serializeSvg(clone)
      if (format === 'svg') {
        downloadBlob(new Blob([src], { type: 'image/svg+xml;charset=utf-8' }), 'knowledge-graph.svg')
        return
      }
      const img = new Image()
      img.onload = () => {
        const scale = 2 // export at 2× for crisp raster output
        const canvas = document.createElement('canvas')
        canvas.width = view.w * scale
        canvas.height = view.h * scale
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.fillStyle = theme.SURFACE
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => {
          if (blob) downloadBlob(blob, 'knowledge-graph.png')
        }, 'image/png')
      }
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(src)))}`
    },
    resetPins: () => {
      setPinned(new Map())
      savePins(new Map())
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
        const factor = e.deltaY > 0 ? 1.096 : 1 / 1.096
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
    const rect = e.currentTarget.getBoundingClientRect()
    // Dragging a node repositions it (a pin) instead of panning the canvas. Node
    // moves bubble to the svg, so we branch here on the nodeDrag ref.
    const nd = nodeDrag.current
    if (nd) {
      if ((e.buttons & 1) === 0) {
        nodeDrag.current = null
        return
      }
      const dx = ((e.clientX - nd.startX) / rect.width) * view.w
      const dy = ((e.clientY - nd.startY) / rect.height) * view.h
      if (Math.abs(e.clientX - nd.startX) + Math.abs(e.clientY - nd.startY) > 4) nd.moved = true
      if (nd.moved) {
        const base = posRef.current.get(nd.id)
        if (base) {
          setPinned((prev) => new Map(prev).set(nd.id, { x: base.x + dx, y: base.y + dy }))
          // Incremental: fold this delta into the base, restart from here.
          nd.startX = e.clientX
          nd.startY = e.clientY
        }
      }
      return
    }
    const d = drag.current
    // Only pan while the primary button is held — a lost pointerup (e.g.
    // released outside the svg) must not leave the canvas following the mouse.
    if (!d || (e.buttons & 1) === 0) {
      drag.current = null
      return
    }
    const dx = ((e.clientX - d.startX) / rect.width) * d.view.w
    const dy = ((e.clientY - d.startY) / rect.height) * d.view.h
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 4) d.moved = true
    setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy })
  }
  const onPointerUp = () => {
    const wasDrag = drag.current?.moved
    drag.current = null
    nodeDrag.current = null
    if (!wasDrag) onSelect(null) // click on empty canvas clears the selection
  }
  const onPointerCancel = () => {
    drag.current = null
    nodeDrag.current = null
  }

  // Persist pins whenever they change (bounded graph → cheap; guarantees a drag
  // survives reload even if the pointerup lands off-canvas).
  useEffect(() => {
    savePins(pinned)
  }, [pinned])

  // Mini-map click/drag → recenter the main view on the picked world point.
  const onMiniPoint = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const world = miniToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
    setView((v) => ({ x: world.x - v.w / 2, y: world.y - v.h / 2, w: v.w, h: v.h }))
  }

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>()
    for (const n of data.nodes) m.set(n.id, n)
    return m
  }, [data])
  const radiusOf = (id: string) =>
    TYPE_RADIUS[nodeById.get(id)?.type ?? 'widget'] ?? DEFAULT_RADIUS

  const visible = useMemo(
    () =>
      data.nodes.filter(
        (n) =>
          !hiddenTypes.has(n.type) &&
          // "Only unhealthy": drop nodes that are healthy or carry no status.
          (!unhealthyOnly || (n.status != null && n.status !== 'ok')),
      ),
    [data, hiddenTypes, unhealthyOnly],
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
        const a = pos.get(e.source)
        const b = pos.get(e.target)
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
    [data, pos, nodeById],
  )

  // Dim precedence: hover neighbors win, then impact-mode highlight.
  const dim = (id: string) => {
    if (hoverSet) return !hoverSet.has(id)
    if (highlight) return !highlight.has(id)
    return false
  }
  const edgeActive = (source: string, target: string) => {
    // Path edges stay lit regardless of hover/selection so the route reads clearly.
    if (pathEdgeKeys?.has(pathEdgeKey(source, target))) return true
    if (hoverId) return source === hoverId || target === hoverId
    if (selectedId) return source === selectedId || target === selectedId
    return false
  }

  const zoom = LAYOUT_W / view.w // 1 = fit; >1 zoomed in; <1 zoomed out
  const tipScale = view.w / LAYOUT_W // keeps the in-SVG tooltip a constant on-screen size

  const hovered = hoverId ? pos.get(hoverId) : null
  const hoveredNode = hoverId ? nodeById.get(hoverId) : null

  return (
    <div className={`relative ${className}`}>
    <svg
      ref={svgRef}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="h-full w-full cursor-grab touch-none select-none rounded-2xl border border-line bg-surface shadow-[0_16px_50px_-24px_rgba(40,32,24,0.45)] active:cursor-grabbing"
      data-testid="force-graph"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        onPointerCancel()
        setHoveredId(null)
      }}
      onContextMenu={(e) => {
        // Node/edge handlers stopPropagation, so this only fires on empty canvas.
        e.preventDefault()
        onCanvasContextMenu?.(e)
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
        if (hiddenKinds?.has(g.kind)) return null
        const dimmed = dim(g.source) || dim(g.target)
        const active = !dimmed && edgeActive(g.source, g.target)
        return (
          <g key={i} data-edge-kind={g.kind}>
            {/* Invisible wide band captures right-clicks on the thin curve. Only
                present when an edge menu is wired so it never intercepts pointers
                otherwise. */}
            {onEdgeContextMenu && (
              <path
                d={g.d}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                pointerEvents="stroke"
                className="cursor-context-menu"
                data-edge-hit={`${g.source}|${g.target}|${g.kind}`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onEdgeContextMenu({ source: g.source, target: g.target, kind: g.kind }, e)
                }}
              />
            )}
            <path
              d={g.d}
              fill="none"
              stroke={active ? theme.ACCENT : theme.EDGE}
              strokeWidth={active ? 2 : dimmed ? 0.7 : 1.4}
              opacity={dimmed ? 0.28 : active ? 0.95 : 0.75}
              markerEnd={active ? 'url(#graph-arrow-active)' : 'url(#graph-arrow)'}
              pointerEvents="none"
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
        const p = pos.get(n.id)
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
            onContextMenu={(e) => {
              // stopPropagation so the svg's canvas menu doesn't also fire.
              e.preventDefault()
              e.stopPropagation()
              onNodeContextMenu?.(n.id, e)
            }}
            onPointerDown={(e) => {
              // Claim the drag for this node so the svg starts a reposition, not a
              // pan. stopPropagation keeps the canvas pan from also starting.
              e.stopPropagation()
              nodeDrag.current = { id: n.id, startX: e.clientX, startY: e.clientY, moved: false }
            }}
            onPointerEnter={() => {
              // Skip while panning or dragging a node — the cursor sweeping over
              // nodes mid-drag must not fire hover emphasis/tooltip flicker.
              if (!drag.current && !nodeDrag.current) setHoveredId(n.id)
            }}
            onPointerLeave={() => setHoveredId((cur) => (cur === n.id ? null : cur))}
            onPointerUp={(e) => {
              const nd = nodeDrag.current
              nodeDrag.current = null
              if (nd?.moved) {
                // Finished repositioning → keep the current selection, don't let
                // the svg's pointerup fire its empty-canvas deselect.
                e.stopPropagation()
                return
              }
              if (!drag.current?.moved) {
                e.stopPropagation()
                drag.current = null
                onSelect(n.id)
              }
            }}
          >
            {emphasized && <circle r={r + 9} fill={color} opacity={0.18} style={{ pointerEvents: 'none' }} />}
            {/* Trust ring: a thin colored halo for non-ok health (verified metrics
                and fresh sources read as clean, unringed nodes). */}
            {n.status && n.status !== 'ok' && (
              <circle
                r={r + 3.5}
                fill="none"
                stroke={HEALTH_COLOR[n.status]}
                strokeWidth={2.5}
                opacity={dimmed ? 0.4 : 0.9}
                style={{ pointerEvents: 'none' }}
              />
            )}
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

      {/* Overview mini-map: whole canvas in world coords + the current viewport;
          click or drag to recenter. Sits over the bottom-right of the canvas. */}
      {showMiniMap && (
        <svg
          width={MINI_W}
          height={MINI_H}
          viewBox={`0 0 ${LAYOUT_W} ${LAYOUT_H}`}
          className="absolute bottom-3 right-3 cursor-pointer touch-none rounded-lg border border-line bg-surface/85 shadow-[0_8px_24px_-12px_rgba(40,32,24,0.4)] backdrop-blur"
          aria-hidden
          onPointerDown={onMiniPoint}
          onPointerMove={(e) => {
            if ((e.buttons & 1) !== 0) onMiniPoint(e)
          }}
        >
          {visible.map((n) => {
            const p = pos.get(n.id)
            if (!p) return null
            return (
              <circle
                key={n.id}
                cx={p.x}
                cy={p.y}
                r={8}
                fill={GRAPH_TYPE_COLORS[n.type] ?? theme.ACCENT}
              />
            )
          })}
          <rect
            x={view.x}
            y={view.y}
            width={view.w}
            height={view.h}
            fill={theme.ACCENT}
            fillOpacity={0.12}
            stroke={theme.ACCENT}
            strokeWidth={6}
          />
        </svg>
      )}
    </div>
  )
})
