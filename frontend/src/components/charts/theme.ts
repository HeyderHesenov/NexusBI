import { useThemeStore } from '../../store/themeStore'
import type { GraphHealthStatus, GraphNodeType } from '../../types'

type Mode = 'light' | 'dark'

// App-wide danger/negative color (same hex the rest of the UI uses inline).
export const DANGER = '#D87C6B'

// Trust-overlay ring color per health severity. Extracted (not inline) so the
// mapping is unit-testable. `ok` never renders a ring (see ForceGraph), but is
// included so the record is exhaustive.
export const HEALTH_COLOR: Record<GraphHealthStatus, string> = {
  ok: '#0E9F6E', // emerald
  warn: '#CBB25E', // gold
  danger: DANGER, // clay red
  unknown: '#8C877E', // neutral grey
}

// Emerald-led categorical palette — reads well on both themes.
export const SERIES = [
  '#0E9F6E', // emerald (accent)
  '#5BC79A', // light emerald
  '#7C9CC4', // dusty blue
  '#C9A36B', // tan
  '#A88BC0', // mauve
  '#8C877E', // neutral
]

// Knowledge-graph node colors — one distinct, mid-tone hue per asset type so
// no two types collide (the 6-color SERIES forced widget/squery and
// dash/decision to share). Each reads against both the light (#FAF9F5) and
// dark (#171615) canvas, and carries a dark glyph on top at ≥3:1 contrast.
export const GRAPH_TYPE_COLORS: Record<GraphNodeType, string> = {
  ds: '#0E9F6E', // emerald — data source (root)
  table: '#7C9CC4', // dusty blue
  metric: '#CBB25E', // gold
  mnode: '#A88BC0', // mauve
  dash: '#E39A55', // amber
  widget: '#4FAFA6', // teal
  squery: '#CE8CA8', // rose
  decision: '#6E7BB8', // indigo
  column: '#A9BBD0', // muted slate — a lighter sibling of table's dusty blue
}

interface ChartTheme {
  SERIES: string[]
  AXIS: string
  GRID: string
  ACCENT: string
  /** Surface color — node separator ring + label halo on the graph canvas. */
  SURFACE: string
  /** Secondary ink — readable node labels. */
  INK_SOFT: string
  /** Graph edge stroke — stronger than GRID so directional links read. */
  EDGE: string
  tooltipStyle: Record<string, unknown>
  tooltipItem: Record<string, unknown>
  tooltipLabel: Record<string, unknown>
}

const THEMES: Record<Mode, ChartTheme> = {
  light: {
    SERIES,
    AXIS: '#8C877E',
    GRID: '#E5E3DC',
    ACCENT: '#0E9F6E',
    SURFACE: '#FFFFFF',
    INK_SOFT: '#5B5750',
    EDGE: '#CBC6BC',
    tooltipStyle: {
      background: '#FFFFFF',
      border: '1px solid #E5E3DC',
      borderRadius: 10,
      fontSize: 12,
      color: '#1F1E1D',
      boxShadow: '0 8px 24px -12px rgba(60,50,40,0.25)',
    },
    tooltipItem: { color: '#1F1E1D' },
    tooltipLabel: { color: '#5B5750' },
  },
  dark: {
    SERIES,
    AXIS: '#7C766E',
    GRID: '#3A3733',
    ACCENT: '#10B981',
    SURFACE: '#1F1E1D',
    INK_SOFT: '#A8A39B',
    EDGE: '#4A463F',
    tooltipStyle: {
      background: '#1F1E1D',
      border: '1px solid #3A3733',
      borderRadius: 10,
      fontSize: 12,
      color: '#EDEAE6',
      boxShadow: '0 8px 24px -10px rgba(0,0,0,0.6)',
    },
    tooltipItem: { color: '#EDEAE6' },
    tooltipLabel: { color: '#A8A39B' },
  },
}

export function chartTheme(mode: Mode): ChartTheme {
  return THEMES[mode]
}

/** Theme-aware chart palette; re-renders the chart when the user toggles theme. */
export function useChartTheme(): ChartTheme {
  return chartTheme(useThemeStore((s) => s.mode))
}
