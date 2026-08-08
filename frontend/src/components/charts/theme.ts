import { useThemeStore } from '../../store/themeStore'
import type { GraphHealthStatus, GraphNodeType } from '../../types'

type Mode = 'light' | 'dark'

/**
 * Chart colours, per theme.
 *
 * WHY THESE ARE HEX AND NOT CSS TOKENS. They used to be, in spirit — the file
 * claimed charts "cannot resolve CSS custom properties". That was never quite
 * the reason (SVG `fill` does resolve `rgb(var(--x))`, and PieChartWidget shipped
 * two of them). The real reason is one directory over, in `lib/chartExport.ts`:
 * image export serializes the live <svg> and hands it to the browser as a
 * standalone document. A detached SVG has no :root to resolve `var()` against,
 * so every token-coloured mark loses its colour in the exported PNG. Hex travels;
 * `var()` does not.
 *
 * WHY THEY ARE PER-MODE. Every colour below used to be shared by both themes,
 * and every one of them was tuned on the dark canvas: measured against the light
 * surfaces, 14 of the 20 fell under the 3:1 non-text floor of WCAG 1.4.11
 * (SERIES 4/6, GRAPH_TYPE_COLORS 7/9, HEALTH_COLOR 2/4, DANGER 1/1) while all 20
 * passed on dark.
 *
 * A single shared palette can satisfy both canvases, but only inside
 * `0.162 ≤ relative luminance ≤ 0.268` — a window 0.106 wide. Six hues crammed
 * into it are separated by at most 1.50:1 from each other, i.e. they differ in
 * hue alone and collapse into one grey for anyone who cannot use hue. Splitting
 * the palette by mode gives each canvas the full range instead, so the light set
 * below keeps the dark set's hues and simply goes deeper.
 *
 * The dark values are byte-identical to what shipped before the split. The light
 * ones are new, and each was measured against `--bg` / `--surface` /
 * `--surface-2`; the worst case of the three is quoted.
 */

/** Near-black ink that rides on top of every graph node. */
export const GLYPH = '#1B1A18'

/** How many distinct series a chart can show before hues repeat. */
export const SERIES_COUNT = 6

/**
 * Emerald-led categorical palette.
 *
 * The light set is spread across luminance 0.071–0.240 rather than packed at the
 * top of the legal range: the smallest gap between neighbours is 0.027, which is
 * what keeps the six readable as six in greyscale and under colour-blind
 * simulation. Packing them all just under the 3:1 ceiling would have passed the
 * same automated check and produced six colours nobody can tell apart.
 *
 * `[0]` is the `--accent` token exactly — see the note on ACCENT.
 */
const SERIES_LIGHT = [
  '#0A6E4C', // emerald (accent)    5.69
  '#318F67', // light emerald       3.63
  '#476E9F', // dusty blue          4.77
  '#5F4723', // tan                 7.90
  '#8D68AD', // mauve               4.04
  '#8B867C', // neutral             3.29
]

const SERIES_DARK = [
  '#0E9F6E', // emerald (accent)    4.40
  '#5BC79A', // light emerald       7.14
  '#7C9CC4', // dusty blue          5.25
  '#C9A36B', // tan                 6.33
  '#A88BC0', // mauve               5.04
  '#8C877E', // neutral             4.17
]

/**
 * Danger/negative for GRAPHICS ONLY — strokes, fills, backgrounds.
 *
 * Never as text: `theme.contrast.test` fails the build if it lands behind a
 * `style` colour or an SVG text `fill`. Text takes `rgb(var(--danger))` or the
 * `text-danger` class.
 *
 * ✅ THE DIVERGENCE THIS FILE USED TO DOCUMENT IS CLOSED. Both values are now
 * the app's own `--danger` token — dark always was (216 124 107), and light can
 * be now that it no longer has to double as a dark-canvas colour. A chart no
 * longer draws its bar in one red while the label describing it renders another.
 */
const DANGER_LIGHT = '#AB4A37' // = --danger 171 74 55   · 5.06 as a graphic
const DANGER_DARK = '#D87C6B' // = --danger 216 124 107 · 4.97

/** Accent, matching `--accent` in both modes for the same reason as DANGER. */
const ACCENT_LIGHT = '#0A6E4C' // = --accent 10 110 76 · 5.69
const ACCENT_DARK = '#10B981' // = --accent 16 185 129 · 4.63

/**
 * Trust-overlay ring colour per health severity. Extracted (not inline) so the
 * mapping is unit-testable. `ok` never renders a ring (see ForceGraph), but is
 * included so the record is exhaustive.
 *
 * Scored on the COMPOSITE, not the hex: the ring is drawn at `opacity 0.9`, so
 * the number that matters is what 90% of the colour over `--surface` comes to.
 * The light ratios below are that composite.
 */
const HEALTH_LIGHT: Record<GraphHealthStatus, string> = {
  ok: ACCENT_LIGHT, // 5.11
  warn: '#6F5E24', // 5.04
  danger: DANGER_LIGHT, // 4.62
  unknown: '#807B72', // 3.52
}

const HEALTH_DARK: Record<GraphHealthStatus, string> = {
  ok: '#0E9F6E', // 4.22
  warn: '#CBB25E', // 6.71
  danger: DANGER_DARK, // 4.78
  unknown: '#8C877E', // 4.02
}

/**
 * Knowledge-graph node colours — one distinct, mid-tone hue per asset type so no
 * two types collide (the 6-colour SERIES forced widget/squery and dash/decision
 * to share).
 *
 * These answer to TWO floors, not one: 3:1 against the canvas AND 3:1 against
 * the GLYPH sitting on top of them. The glyph is what stops the light set from
 * simply reusing `--accent` for `ds` the way SERIES[0] does — the token is dark
 * enough that a near-black glyph on it measures 2.77, so `ds` is a slightly
 * lighter emerald here. Two constraints pulling opposite ways is exactly the
 * kind of thing a single "make it darker" pass gets wrong silently.
 */
const GRAPH_LIGHT: Record<GraphNodeType, string> = {
  //                    canvas · glyph
  ds: '#0B8159', //       4.89 · 3.56  emerald — data source (root)
  table: '#547EB2', //    4.20 · 4.14  dusty blue
  metric: '#9D8433', //   3.63 · 4.79  gold
  mnode: '#8D68AD', //    4.45 · 3.91  mauve
  dash: '#C06E20', //     3.82 · 4.55  amber
  widget: '#3E8A83', //   4.06 · 4.28  teal
  squery: '#B95B83', //   4.30 · 4.05  rose
  decision: '#5F6DB1', // 4.87 · 3.57  indigo
  column: '#6E8DB0', //   3.44 · 5.05  muted slate
}

const GRAPH_DARK: Record<GraphNodeType, string> = {
  ds: '#0E9F6E',
  table: '#7C9CC4',
  metric: '#CBB25E',
  mnode: '#A88BC0',
  dash: '#E39A55',
  widget: '#4FAFA6',
  squery: '#CE8CA8',
  decision: '#6E7BB8',
  column: '#A9BBD0',
}

export interface ChartTheme {
  SERIES: string[]
  AXIS: string
  GRID: string
  ACCENT: string
  /** Danger/negative — graphics only. See DANGER_LIGHT. */
  DANGER: string
  /** Ring colour per health severity. */
  HEALTH_COLOR: Record<GraphHealthStatus, string>
  /** Node fill per asset type. */
  GRAPH_TYPE_COLORS: Record<GraphNodeType, string>
  /** Surface color — node separator ring + label halo on the graph canvas. */
  SURFACE: string
  /** Secondary ink — readable node labels. */
  INK_SOFT: string
  /** Faint ink — the folded "other" wedge, and anything else deliberately quiet. */
  INK_FAINT: string
  /** Graph edge stroke — stronger than GRID so directional links read. */
  EDGE: string
  tooltipStyle: Record<string, unknown>
  tooltipItem: Record<string, unknown>
  tooltipLabel: Record<string, unknown>
}

const THEMES: Record<Mode, ChartTheme> = {
  light: {
    SERIES: SERIES_LIGHT,
    AXIS: '#8C877E',
    GRID: '#E5E3DC',
    ACCENT: ACCENT_LIGHT,
    DANGER: DANGER_LIGHT,
    HEALTH_COLOR: HEALTH_LIGHT,
    GRAPH_TYPE_COLORS: GRAPH_LIGHT,
    SURFACE: '#FFFFFF',
    INK_SOFT: '#5B5750',
    INK_FAINT: '#8C877E',
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
    SERIES: SERIES_DARK,
    AXIS: '#7C766E',
    GRID: '#3A3733',
    ACCENT: ACCENT_DARK,
    DANGER: DANGER_DARK,
    HEALTH_COLOR: HEALTH_DARK,
    GRAPH_TYPE_COLORS: GRAPH_DARK,
    SURFACE: '#1F1E1D',
    INK_SOFT: '#A8A39B',
    INK_FAINT: '#7C766E',
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

/** Asset types in declaration order — for legends that list every type. */
export const GRAPH_TYPES = Object.keys(GRAPH_DARK) as GraphNodeType[]

export function chartTheme(mode: Mode): ChartTheme {
  return THEMES[mode]
}

/** Theme-aware chart palette; re-renders the chart when the user toggles theme. */
export function useChartTheme(): ChartTheme {
  return chartTheme(useThemeStore((s) => s.mode))
}
