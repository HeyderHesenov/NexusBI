import { useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData, GraphNodeType } from '../../types'
import { SERIES, useChartTheme } from '../charts/theme'
import { LAYOUT_H, LAYOUT_W, useForceLayout } from './useForceLayout'

interface Props {
  data: GraphData
  selectedId: string | null
  /** Nodes to highlight (impact mode); null = highlight everything. */
  highlight: Set<string> | null
  onSelect: (id: string | null) => void
}

// Stable type→color assignment from the shared chart palette.
export const TYPE_COLOR: Record<GraphNodeType, string> = {
  ds: SERIES[5],
  table: SERIES[3],
  metric: SERIES[1],
  mnode: SERIES[4],
  widget: SERIES[2],
  dash: SERIES[0],
  squery: SERIES[2],
  decision: SERIES[0],
}

const TYPE_RADIUS: Record<GraphNodeType, number> = {
  ds: 14, table: 12, dash: 13, widget: 9, metric: 10, mnode: 10, squery: 9, decision: 11,
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4

/** Interactive SVG knowledge graph: wheel zoom, drag-pan, click-select. */
export function ForceGraph({ data, selectedId, highlight, onSelect }: Props) {
  const theme = useChartTheme()
  const nodeIds = useMemo(() => data.nodes.map((n) => n.id), [data])
  const layout = useForceLayout(nodeIds, data.edges)
  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState({ x: 0, y: 0, w: LAYOUT_W, h: LAYOUT_H })
  const drag = useRef<{ startX: number; startY: number; view: typeof view; moved: boolean } | null>(null)

  // Plain wheel must zoom the canvas, so the listener has to be non-passive
  // (React's onWheel is passive → preventDefault would be ignored).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12
        const w = Math.min(Math.max(v.w * factor, LAYOUT_W / MAX_ZOOM), LAYOUT_W / MIN_ZOOM)
        const h = (w / LAYOUT_W) * LAYOUT_H
        const rect = svg.getBoundingClientRect()
        const px = (e.clientX - rect.left) / rect.width
        const py = (e.clientY - rect.top) / rect.height
        return {
          x: v.x + (v.w - w) * px,
          y: v.y + (v.h - h) * py,
          w,
          h,
        }
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

  const dim = (id: string) => (highlight ? !highlight.has(id) : false)

  return (
    <svg
      ref={svgRef}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="h-[560px] w-full cursor-grab touch-none select-none rounded-2xl border border-line bg-surface active:cursor-grabbing"
      data-testid="force-graph"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerCancel}
    >
      {data.edges.map((e, i) => {
        const a = layout.get(e.source)
        const b = layout.get(e.target)
        if (!a || !b) return null
        const dimmed = dim(e.source) || dim(e.target)
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={theme.GRID}
            strokeWidth={dimmed ? 0.6 : 1.4}
            opacity={dimmed ? 0.25 : 0.8}
          />
        )
      })}
      {data.nodes.map((n) => {
        const p = layout.get(n.id)
        if (!p) return null
        const dimmed = dim(n.id)
        const r = TYPE_RADIUS[n.type] ?? 10
        return (
          <g
            key={n.id}
            transform={`translate(${p.x},${p.y})`}
            opacity={dimmed ? 0.22 : 1}
            className="cursor-pointer"
            data-node-id={n.id}
            onPointerUp={(e) => {
              if (!drag.current?.moved) {
                e.stopPropagation()
                drag.current = null
                onSelect(n.id)
              }
            }}
          >
            <circle
              r={r}
              fill={TYPE_COLOR[n.type] ?? theme.ACCENT}
              stroke={n.id === selectedId ? theme.ACCENT : 'transparent'}
              strokeWidth={3}
            />
            <text
              y={r + 12}
              textAnchor="middle"
              fontSize={11}
              fill={theme.AXIS}
              style={{ pointerEvents: 'none' }}
            >
              {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
