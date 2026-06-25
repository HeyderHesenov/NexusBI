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
