import { useThemeStore } from '../../store/themeStore'

type Mode = 'light' | 'dark'

// Emerald-led categorical palette — reads well on both themes.
export const SERIES = [
  '#0E9F6E', // emerald (accent)
  '#5BC79A', // light emerald
  '#7C9CC4', // dusty blue
  '#C9A36B', // tan
  '#A88BC0', // mauve
  '#8C877E', // neutral
]

interface ChartTheme {
  SERIES: string[]
  AXIS: string
  GRID: string
  ACCENT: string
  // Bar value-ramp endpoints: small values → BAR_LOW, large → BAR_HIGH.
  BAR_LOW: string
  BAR_HIGH: string
  tooltipStyle: Record<string, unknown>
  tooltipItem: Record<string, unknown>
  tooltipLabel: Record<string, unknown>
}

/** Linearly interpolate between two hex colors (#rrggbb). t is clamped to [0,1]. */
export function lerpColor(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const mix = (sh: number) => {
    const ca = (pa >> sh) & 0xff
    const cb = (pb >> sh) & 0xff
    return Math.round(ca + (cb - ca) * k)
  }
  const to2 = (n: number) => n.toString(16).padStart(2, '0')
  return `#${to2(mix(16))}${to2(mix(8))}${to2(mix(0))}`
}

const THEMES: Record<Mode, ChartTheme> = {
  light: {
    SERIES,
    AXIS: '#8C877E',
    GRID: '#E5E3DC',
    ACCENT: '#0E9F6E',
    BAR_LOW: '#A7DFC6',
    BAR_HIGH: '#0B7E58',
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
    BAR_LOW: '#1F6B4F',
    BAR_HIGH: '#34D399',
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
