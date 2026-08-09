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
 * surfaces, 15 of the 20 fell under the 3:1 non-text floor of WCAG 1.4.11
 * (SERIES 4/6, GRAPH_TYPE_COLORS 7/9, HEALTH_COLOR 3/4, DANGER 1/1) while all 20
 * passed on dark.
 *
 * The health three are counted the way the ring paints them: composited at
 * opacity 0.9 over `--surface`, the one canvas it lands on. That is ok 2.99,
 * warn 1.92, danger 2.66 — while `unknown` clears at 3.06. Both other ways of
 * counting are wrong and both have stood in this comment: at raw hex it reads
 * 2/4 (a floor no ring is ever painted at), and over `--surface-2` it reads 4/4
 * (a surface this ring never touches). Quote the backdrop, or the number means
 * nothing.
 *
 * A single shared palette can satisfy both canvases, but only inside
 * `0.162 ≤ relative luminance ≤ 0.268` — a window 0.106 wide, across which the
 * lightest and darkest of six hues can differ by at most 1.50:1. Everything is
 * then within half a stop of everything else, and the set collapses into one
 * tone for anyone who cannot use hue. Splitting by mode gives each canvas the
 * full range instead: the light set below spans 2.65:1 end to end and the dark
 * set 2.11:1, against the 1.50:1 a shared palette is capped at.
 *
 * ⚠️ The gain is in RANGE, not in neighbour separation — adjacent pairs in the
 * light set sit 1.02–1.46:1 apart, which is no better than the packed
 * alternative and would be dishonest to claim as the win. Nor does the span buy
 * greyscale legibility, which an earlier version of this paragraph claimed: two
 * of the light six sit 0.4 L* apart and photocopy to the same grey. What the
 * palette is actually chosen against is the pairwise dichromacy floor described
 * below — greyscale is a separate and still-open property, measured there rather
 * than implied here.
 *
 * Both sets were re-picked against that floor, so neither is what shipped before
 * the split. Each colour was measured against `--bg` / `--surface` /
 * `--surface-2`; the worst case of the three is quoted.
 */

/** Near-black ink that rides on top of every graph node. */
export const GLYPH = '#1B1A18'

/** How many distinct series a chart can show before hues repeat. */
export const SERIES_COUNT = 6

/**
 * Emerald-led categorical palette, spread by LIGHTNESS on purpose.
 *
 * WHO THIS IS SPREAD FOR. Dichromacy does not dull hue, it deletes an axis:
 * deuteranopia and protanopia remove red-green, tritanopia removes blue-yellow.
 * What survives is lightness plus the one axis still standing — so two series
 * that differ only along the missing axis merge completely, however far apart
 * they look to everyone else.
 *
 * These six hues sit close together on the surviving axis (four of them are
 * green-through-blue), so in practice lightness was carrying much of it. That is
 * a fact about THIS palette's hues, not a general law — a set built on opposite
 * ends of blue-yellow could stay apart with less lightness range.
 *
 * ⚠️ AN EARLIER VERSION PUT A CLEAN RULE HERE — "every failing pair had ΔL* under
 * 5 and every passing pair had ΔL* over 12, in both modes" — and the old palette
 * it cites does not show one. Passing light pairs run 3.1, 5.9, 7.6, 8.9, 9.4,
 * 10.5 …; the dark set has a FAILING pair at ΔL* 9.8 and passing pairs at 3.9 and
 * 4.1. There is no 5/12 separation in either mode, so "hence, spread by
 * lightness" never followed from the numbers quoted for it. Lightness genuinely
 * helps here; it was not the clean lever that sentence described.
 *
 * ⚠️ And lightness describes the SEARCH, not the RESULT — the difference matters
 * because two pairs clear the floor on surviving hue alone: light `[1]`/`[4]` at
 * ΔL* 0.4 and dark `[3]`/`[0]` at ΔL* 1.7. The first scores ΔE 43.1 under
 * deuteranopia at essentially equal lightness — deuteranopia removes red-green
 * and leaves blue-yellow standing, and green-vs-violet is exactly that axis.
 * Lightness does most of the work in this set. It does not do all of it, and a
 * future edit that trusts "spread by lightness" as an invariant will be wrong
 * about those two pairs.
 *
 * That is why an earlier framing of this ticket — "separate the hues of the two
 * pairs that collide" — was abandoned after measurement. Changing a hue cannot
 * help a reader who has no hue.
 *
 * WHAT IS ASSERTED. `theme.test` scores every pair a chart can actually paint
 * side by side — the six against each other AND against the folded-"other"
 * INK_FAINT wedge — at a 10 ΔE floor in normal vision and under all three
 * dichromacies, plus every colour against every surface at 3:1. The dichromacy
 * floor is the binding one: the palette this replaced measured 2.2 (dark) and
 * 5.2 (light) there while passing everything else, which is exactly how it
 * shipped unnoticed.
 *
 * ⚠️ The light figure was written as 6.5 one paragraph from a test asserting 5.2.
 * 5.2 is right; 6.5 was the protan/deutan minimum with tritanopia dropped, and
 * the same omission is what miscounted the node-colour pairs further down.
 *
 * ⚠️ AND THE FLOOR IS SOFTER THAN "10 ΔE ≈ four JNDs" SOUNDS, because CIE76 is
 * not CIEDE2000. Scored with CIEDE2000 (validated against Sharma's vectors) the
 * weakest pairs are light [0]/[2] at 5.37 and dark [1]/[2] at 5.34, both under
 * tritanopia — pairs CIE76 rates 17.8 and 12.0, i.e. it does not identify its own
 * weakest link, because its largest errors sit in exactly the blue/violet region
 * these live in. The change is still a real improvement (the old palette measures
 * 2.85 and 1.02 the same way) but the honest claim is "3-5× better", not "clears
 * four JNDs". Moving to CIEDE2000 is a ticket, and it has to follow the tritan
 * model fix — see `dichromacyGamutError`.
 *
 * WHAT IS NOT: greyscale. Every dichromacy model PRESERVES lightness, so no
 * simulation in that test can see a pair that differs only in hue, and the check
 * this replaced could not either — a luminance gap between sorted NEIGHBOURS
 * says nothing about the pair two steps apart. Scored properly, 4 light pairs
 * and 8 dark fall under the same 10 ΔE floor in greyscale, worst 0.4. That is
 * not something this palette broke (the one it replaced measured 8 and 9, worst
 * 1.1) and not something any version here has ever covered. Monochrome print is
 * its own ticket; do not read a dichromacy pass as standing in for it.
 *
 * ⚠️ BEFORE ADDING A SEVENTH COLOUR, note that the arithmetic this docblock used
 * to offer for "a seventh does not fit" was wrong twice over. It said six colours
 * want ~50 L* units of room — but the shipped six span only 26.9 L* (light) and
 * 23.8 (dark) and clear the floor anyway, precisely because pairs can also
 * separate on surviving hue, which this same docblock says two paragraphs up. It
 * also counted intervals wrongly elsewhere (nine colours is eight gaps, not
 * nine). The room is genuinely tight — dark leaves 52.8 L* above the 3:1 floor —
 * but "does not fit" was asserted, not shown. A seventh needs measuring, not a
 * rule of thumb.
 *
 * `[0]` is the `--accent` token exactly, in BOTH modes. It was only ever true
 * of light: dark shipped #0E9F6E against an --accent of #10B981, so the comment
 * that claimed it was half wrong. Freezing [0] to the token here is what makes
 * the sentence true and closes the last chart/app colour divergence.
 */
// Ratios are worst-of-three background contrast, as everywhere else in this file.
const SERIES_LIGHT = [
  '#0A6E4C', // emerald (accent)    5.69  — frozen: this IS the --accent token
  '#009562', // light emerald       3.48
  '#50698D', // dusty blue          5.09
  '#594529', // tan                 8.26
  '#9776B3', // mauve               3.43
  '#8F8A80', // neutral             3.12  — the tightest of the six
]

const SERIES_DARK = [
  '#10B981', // emerald (accent)    5.87  — frozen: this IS the --accent token
  '#86D7B2', // light emerald       8.77
  '#93B1D9', // dusty blue          6.75
  '#BE985F', // tan                 5.56
  '#977CAC', // mauve               4.11  — the tightest of the six
  '#948F86', // neutral             4.65
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
const ACCENT_DARK = '#10B981' // = --accent 16 185 129 · 5.87

/**
 * Trust-overlay ring colour per health severity. Extracted (not inline) so the
 * mapping is unit-testable. `ok` never renders a ring (see ForceGraph), but is
 * included so the record is exhaustive.
 *
 * Scored on the COMPOSITE, not the hex: the ring is drawn at `opacity 0.9`, so
 * the number that matters is what 90% of the colour over `--surface` comes to.
 * The light ratios below are that composite.
 *
 * `--surface` alone, and not the worst of the three surfaces the palette above
 * is quoted against, because this ring is not free to land anywhere: it is only
 * ever drawn on the graph canvas, which is `bg-surface` (ForceGraph) and exports
 * on `theme.SURFACE`. The others still clear the floor there anyway — `unknown`,
 * the tightest, holds 3.24 on `--surface-2` — so the narrower scope is a
 * statement about where the mark lives, not a softer bar.
 */
const HEALTH_LIGHT: Record<GraphHealthStatus, string> = {
  ok: ACCENT_LIGHT, // 5.11
  warn: '#6F5E24', // 5.04
  danger: DANGER_LIGHT, // 4.62
  unknown: '#807B72', // 3.52
}

/**
 * Opacity the trust ring is painted at, and therefore the opacity its contrast
 * is scored at.
 *
 * Exported and imported by ForceGraph rather than written down in both places:
 * the ratios above are only true at this number, so a component free to pick its
 * own would invalidate them silently. The guard that used to grep ForceGraph for
 * the literal is still there, but it is now a second line of defence rather than
 * the only thing joining the two.
 */
export const RING_OPACITY = 0.9

const HEALTH_DARK: Record<GraphHealthStatus, string> = {
  ok: ACCENT_DARK, // 5.58 composited — the light side has said `ok: ACCENT_LIGHT`
  //                  all along, and this was the hardcoded twin that made
  //                  "closes the LAST chart/app colour divergence" untrue.
  warn: '#CBB25E', // 6.71
  danger: DANGER_DARK, // 4.78
  unknown: '#8C877E', // 4.02
}

/**
 * Knowledge-graph node colours — one distinct, mid-tone hue per asset type so no
 * two types collide (the 6-colour SERIES forced widget/squery and dash/decision
 * to share).
 *
 * ⚠️ "No two collide" holds in normal vision only, and unlike SERIES that is
 * ACCEPTED here rather than fixed. Scored against the same 10 ΔE floor, **11 of
 * the 36 light pairs and 6 of the 36 dark** fall under it beneath some
 * dichromacy — worst `metric`/`squery` at ΔE 1.0 under tritanopia, which is one
 * colour, not two.
 *
 * (Those counts read 14 and 9 for one commit. That was pairs-times-conditions out
 * of 108 reported as pairs out of 36 — the measuring script pushed one row per
 * failing (pair, condition) and the number was quoted without re-reading what it
 * had counted. Same class as the 6.5 above: a figure carried out of the tool that
 * produced it and into a sentence that means something else.)
 *
 * It is accepted because hue is not the channel carrying type here. Every node
 * draws a per-type icon on top (`TYPE_ICON` in ForceGraph — nine types, nine
 * symbols), and the legend, the detail sidebar and the asset picker each pair
 * the swatch with that icon AND the type's name in words. SERIES has no such
 * second channel — nothing but the colour tells one line from another — which is
 * why it was re-picked and this was not.
 *
 * ⚠️ The mini-map is the one colour-only site, and `aria-hidden` is NOT the
 * reason it is tolerable — that was a bad argument, written here for one commit.
 * Removing a node from the accessibility tree helps a screen-reader user; it does
 * nothing for the sighted dichromat this whole floor exists for, who sees the
 * mini-map perfectly well and cannot separate its dots. What actually carries the
 * argument is the other half: the mini-map is a viewport-navigation aid, every
 * node in it is reachable and identifiable in the canvas it mirrors, and nothing
 * is read from it. (It is also an interactive surface — onPointerDown /
 * onPointerMove — hidden from assistive tech, which is its own small ticket.)
 *
 * These answer to TWO floors, not one: 3:1 against the canvas AND 3:1 against
 * the GLYPH sitting on top of them. The glyph is what stops the light set from
 * simply reusing `--accent` for `ds` the way SERIES[0] does — the token is dark
 * enough that a near-black glyph on it measures 2.77, so `ds` is a slightly
 * lighter emerald here. Two constraints pulling opposite ways is exactly the
 * kind of thing a single "make it darker" pass gets wrong silently.
 *
 * Quoted worst-of-three like the rest of the palette, NOT canvas-only: unlike
 * the health ring, these are not confined to the graph. The same colour is a
 * legend chip and a panel header on `--surface-2` (GraphCanvas) and a row marker
 * in the asset picker. An earlier revision quoted the `--surface` figures here
 * while the header two screens up promised worst-of-three; `column` was the tell,
 * reading 3.44 there and 3.12 in fact.
 */
const GRAPH_LIGHT: Record<GraphNodeType, string> = {
  //                    canvas · glyph
  ds: '#0B8159', //       4.43 · 3.56  emerald — data source (root)
  table: '#547EB2', //    3.81 · 4.14  dusty blue
  metric: '#9D8433', //   3.30 · 4.79  gold
  mnode: '#8D68AD', //    4.04 · 3.91  mauve
  dash: '#C06E20', //     3.47 · 4.55  amber
  widget: '#3E8A83', //   3.69 · 4.28  teal
  squery: '#B95B83', //   3.90 · 4.05  rose
  decision: '#5F6DB1', // 4.42 · 3.57  indigo
  column: '#6E8DB0', //   3.12 · 5.05  muted slate — the tightest of the nine
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
