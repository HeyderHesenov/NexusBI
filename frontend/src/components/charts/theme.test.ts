import { describe, expect, it } from 'vitest'
import {
  chartTheme,
  GLYPH,
  GRAPH_TYPES,
  inkFraction,
  RING_DASH,
  RING_OPACITY,
  RINGED_STATUSES,
  SERIES_COUNT,
} from './theme'
import {
  composite,
  contrastRatio,
  deltaE2000,
  dichromacyGamutError,
  hexToRgb,
  relativeLuminance,
  simulateDichromacy,
  toLab,
} from '../../lib/color'
import type { Dichromacy } from '../../lib/color'
import type { GraphHealthStatus } from '../../types'
// `?raw` resolves to the file only because vite.config.ts sets `test.css: true`
// — with vitest's default the import silently yields an empty string, and every
// ratio below would score against a token table that parsed to nothing. The
// "reads the surfaces out of index.css" test is what makes that loud.
import indexCss from '../../index.css?raw'
import forceGraphSrc from '../graph/ForceGraph.tsx?raw'
import { TOP_N } from './PieChartWidget'
import { targetLineProps } from './targetLine'

/** WCAG's non-text floor. Bars, slices, rules, rings, node fills. */
const GRAPHIC = 3
/** WCAG AA for text. */
const TEXT = 4.5
/**
 * Perceptual distance two series must keep, in normal vision and under each
 * dichromacy, in **CIEDE2000** — the ticket that asked for it is closed, and the
 * tritan gamut fix it had to follow landed with it.
 *
 * ⚠️ THE DIGIT DID NOT MOVE WHEN THE METRIC DID, AND IT DID NOT MOVE WHEN THE
 * PALETTE DID EITHER. Adopting ΔE00 left 14 pairs below 10, and re-deriving the
 * floor downward until they passed was available and was refused: a floor chosen
 * to fit the numbers it grades stops being a requirement and becomes a description
 * of the status quo. The colours were re-picked instead, and they now clear it with
 * air — see MARGIN, below. What licenses keeping the same digit across the metric
 * change is that the two are anchored at the same place — black to white is exactly
 * 100 in both — so "10" means the same tenth of the lightness range on either scale.
 *
 * ⚠️ "10 ≈ four JNDs" IS STILL THE WRONG WAY TO READ IT. That arithmetic (~2.3
 * per JND) belongs to CIE76 and was wrong there too, since CIE76 is not uniform.
 * 10 is a working floor for a small mark on a busy chart, not four of anything.
 *
 * ⚠️ AND EVERY NUMBER THIS DOCSTRING USED TO QUOTE WAS A MEASUREMENT OF A BUG.
 * It said the weakest pairs were 5.37 (light) and 5.34 (dark); measured under the
 * Brettel model the same set scored 3.24 and 3.99, and the tritan figures moved
 * most because the old single-plane model threw those colours out of gamut and the
 * simulator clamped them silently. That set is two generations back now — what the
 * shipped one scores is in MARGIN — and the old "3-5× better than the palette it
 * replaced" claim is not restated for the same reason: it was computed against the
 * same clamp.
 *
 * ⚠️ WHICH PALETTES THIS IS POINTED AT, AND WHY NOT THE OTHERS. It scores the
 * marks a single chart can place side by side: the six SERIES, plus the faint-ink
 * mark — the INK_FAINT "other" wedge a folded pie adds AND the AXIS rule, which
 * are one hex. That set is where colour is the ONLY thing telling two marks apart:
 * the line widgets give every series the same width and no dash, pie slices carry
 * no on-arc label, and the axis rule is solid and unlabelled.
 *
 * The tokens deliberately OUTSIDE it, with what that costs, are listed at
 * `UNSCORED_CANVAS_INK` below — an omission with a stated price rather than one
 * nobody wrote down, which is how the axis came to be missed.
 *
 * GRAPH_TYPE_COLORS and HEALTH_COLOR are not scored, and extending this loop to
 * them would report failures that are not defects. Both would fail (11 of the 36
 * light node pairs collide under some dichromacy, worst ΔE 1.0), but node type is
 * carried by a per-type icon plus the type's name in words at every site that
 * reads as data. See the note above GRAPH_LIGHT in theme.ts for the measurement,
 * the reasoning, and why `aria-hidden` is NOT part of it.
 *
 * HEALTH_COLOR was the same shape of gap and is NO LONGER one, but it is scored
 * separately rather than folded in here, because what it has to satisfy is a
 * different sentence: not "these colours stay apart" but "severity is separable
 * by something", which the dash pattern can satisfy instead of the hue. See the
 * ring-severity test below.
 */
const SEPARATION = 10
const DICHROMACIES = ['protan', 'deutan', 'tritan'] as const

/**
 * Lightness distance the same pairs must keep, in L* — the monochrome floor.
 *
 * WHY THIS EXISTS SEPARATELY. Every dichromacy model above PRESERVES lightness, so
 * nothing in the SEPARATION loop can see a pair that differs only in hue, however
 * many conditions it scores. The set two generations back had a pair at ΔL* 0.4 —
 * two colours that photocopy to the same grey — while scoring ΔE 43.1 under
 * deuteranopia, i.e. passing everything here with room to spare. A monochrome
 * reader is not a dichromat with the volume turned down; they are a different
 * reader, and this is the only assertion in the file that reaches them.
 *
 * ⚠️ AND THE TWO FLOORS DO NOT IMPLY EACH OTHER IN EITHER DIRECTION. Strip the hue
 * from the palette below and the worst pair falls to ΔE00 3.62 (light) and 3.15
 * (dark), so clearing ΔL* does not deliver SEPARATION; and the 0.4 pair above shows
 * clearing SEPARATION does not deliver ΔL*. Two requirements, two assertions.
 *
 * ⚠️ WHY 4.5 AND NOT THE 5 THE TICKET ASKED FOR. Measured across the search space:
 * the light set reaches ΔL* 5.05 while moving no colour more than ΔE00 12.1 from
 * its predecessor, but half a point more margin costs a shift of 29.2 — a different
 * palette rather than this one adjusted. Asserting 5 against a measured 5.05 makes
 * the guard a tripwire rather than a requirement, which is the "margin 0.2" mistake
 * this repo has made once already. 4.5 leaves 0.54 (light) and 0.61 (dark) of real
 * air, and MARGIN pins what was actually achieved so the gap is written down.
 *
 * ⚠️ The "no colour moves more than 12.1" costing above is the SEARCH THAT PRECEDED
 * the axis being added to the scored set; SERIES[5] then had to move 30.9 and 33.7.
 * Left in the past tense rather than deleted, because the reason for 4.5 over 5 is
 * still the reason — see the same paragraph in `theme.ts`.
 */
const GREYSCALE = 4.5

/**
 * Ring severities that actually paint a ring — DERIVED from `RING_DASH`, which
 * has to name every one of them anyway. `ok` is absent from that record because
 * ForceGraph never draws a ring for it, a premise `ForceGraph.test` pins by
 * rendering an `ok` node and asserting no ring appears.
 *
 * ⚠️ It used to be this literal in BOTH files, each docstring pointing at the
 * other as the thing keeping it honest, and nothing asserting the two agreed.
 */
const RINGED = RINGED_STATUSES
/** Unordered severity pairs, in a fixed order so failures name a stable pair. */
const PAIRS = RINGED.flatMap((a, i) => RINGED.slice(i + 1).map((b) => [a, b] as const))

/**
 * The four ways two ring colours can be seen — normal vision plus the three
 * dichromacies — as `[condition, ΔE]`. The worst of these is the number the
 * severity design is argued from, so both the value and WHICH condition produced
 * it are read off one function rather than recomputed per assertion.
 */
/**
 * `simulateDichromacy`, with the failure named where it happens.
 *
 * ⚠️ It used to be a bare `!`. A malformed hex in `theme.ts`'s palette makes the
 * simulator return null, and the null then travelled two frames into `color.ts`
 * to die as "Cannot read properties of null (reading 'trim')" — a stack that
 * names neither the colour nor the table it came from. Worse, the `'none'` entry
 * is evaluated first and yields NaN WITHOUT throwing, and NaN then sorts
 * unpredictably, so a metric change that removed the throw could leave
 * `worstOf` returning a finite, passing number for a broken palette.
 */
const simulate = (hex: string, d: Dichromacy) => {
  const out = simulateDichromacy(hex, d)
  if (!out) throw new Error(`${hex} failed to simulate under ${d} — malformed hex in the palette?`)
  return out
}

const separations = (pa: string, pb: string) =>
  [
    ['none', deltaE2000(pa, pb)] as const,
    ...DICHROMACIES.map((d) => [d, deltaE2000(simulate(pa, d), simulate(pb, d))] as const),
  ].sort((x, y) => x[1] - y[1])

/**
 * The worst of the four ways two colours can be seen, as `[condition, ΔE00]`.
 *
 * One call, not two. The separate `worstSeparation`/`worstCondition` helpers this
 * replaced each rebuilt the whole table — six simulations and four distances —
 * so every pair was measured twice, and nothing stopped the two from disagreeing
 * about which entry was worst if the sort were ever made unstable.
 */
const worstOf = (pa: string, pb: string) => separations(pa, pb)[0]

/** `hexToRgb` with the failure named where it happens rather than as a null two frames on. */
const parseHex = (hex: string) => {
  const rgb = hexToRgb(hex)
  if (!rgb) throw new Error(`malformed palette hex: ${hex}`)
  return rgb
}

/** L* of a hex, for the monochrome floor. */
const lightness = (hex: string) => toLab(parseHex(hex))[0]

/**
 * SYNTHETIC PAIRS THAT STRADDLE EACH FLOOR — the only thing in this file that reads
 * the digits themselves.
 *
 * ⚠️ WITHOUT THESE BOTH FLOORS COULD BE MOVED AT WILL, and that was measured, not
 * feared: with the palette clean and `DEBT` empty, `SEPARATION = 1` and
 * `GREYSCALE = 0.5` each left the whole file green. Every other assertion about
 * them is an inequality pointing the same way — a palette that clears 10 also
 * clears 1 — so lowering a floor to fit a future palette was a one-digit edit that
 * no test could see. (The `DEBT` set-equality used to catch it, but only while
 * `DEBT` had rows: once emptied, `[] === []` holds for any floor.)
 *
 * Greys are used on purpose: every dichromacy model preserves them, so the same
 * pair measures the same distance under all four conditions and the probe cannot
 * drift with the simulator. The measured values are pinned too, so a metric change
 * has to come here and restate them rather than quietly re-scale both sides.
 *
 * ⚠️ AND THEY HAVE TO STRADDLE THE DIGIT TIGHTLY, WHICH THE FIRST PAIRS DID NOT.
 * They measured 9.2689 and 10.0855, so the file only ever required SEPARATION to
 * be somewhere in (9.2689, 10.0855] — `const SEPARATION = 9.3` left everything
 * green, a 7% weakening by the same one-digit edit these probes were added to
 * stop, and 4.2792/4.6651 allowed GREYSCALE = 4.3. The pairs below are the
 * tightest straddle available at 8-bit resolution: 0.007 and 0.005 wide, so the
 * digit cannot move by a hundredth in either direction.
 */
const FLOOR_PROBES = {
  // ΔE00, worst of four conditions. The pair that straddles 10 most tightly of all
  // 32640 grey pairs: 9.9997 under, 10.0065 over — 0.007 apart.
  separation: { under: ['#AEAEAE', '#D5D5D5', 9.9997], over: ['#888888', '#A7A7A7', 10.0065] },
  // ΔL*, likewise the tightest straddle of 4.5: 4.4959 under, 4.5010 over.
  greyscale: { under: ['#9E9E9E', '#AAAAAA', 4.4959], over: ['#9D9D9D', '#A9A9A9', 4.5010] },
} as const

type Mark = { hex: string; label: string }

/**
 * The pairs a chart can actually put side by side — the set BOTH palette floors
 * are scored over, so neither can drift onto a different population than the other.
 *
 * ⚠️ THE SET IS "MARKS", NOT "SERIES". Scoring SERIES×SERIES alone let a real
 * collision ship: a folded pie paints its "other" wedge in INK_FAINT, a neutral
 * grey that measured ΔE 1.26 from the neutral-grey SERIES[5] in light mode — in the
 * one widget with no on-arc labels, which is the widget these floors exist for.
 * `TOP_N` is imported rather than reasoned about so the two cannot drift.
 *
 * ⚠️ THE S5/INK_FAINT PAIR USED TO BE EXCLUDED HERE, AND THE ARGUMENT FOR THAT WAS
 * TRUE OF ONE CONTEXT AND FALSE OF THE OTHER. `coexists` skipped it because
 * SERIES[5] is the one series a folded pie never paints — the wedge that would have
 * used it IS the "other" wedge, and that wedge is INK_FAINT — so within a pie the
 * two genuinely cannot appear together. But INK_FAINT is byte-identical to AXIS,
 * and the axis rule is drawn beside every series in every cartesian chart
 * (`BarChartWidget`, `LineChartWidget`, `ScatterChartWidget`, `ForecastChartWidget`,
 * `ScenarioPanel`, and the AXIS-coloured baseline in `MonteCarloPanel`). The
 * exclusion was reasoning about the pie and silencing the axis, and it hid a
 * measured ΔE00 0.91 (dark) and 1.76 (light) between SERIES[5] and the rule beside
 * it. Every pair is scored now; the `AXIS === INK_FAINT` pin below is what licenses
 * scoring one mark for both roles.
 *
 * ⚠️ BY INDEX, NOT BY HEX — the note that outlived the predicate. When there WAS a
 * skip it asked `MARKS[x].hex !== INK_FAINT`, identifying the mark by VALUE, so a
 * palette that gave a SERIES colour the same hex as INK_FAINT would have sent that
 * pair down the else branch and skipped it: no floor assertion, and absent from
 * `below`, so the ratchet would not have noticed either. Two marks being identical
 * is precisely the case these tests exist to catch. Any future exclusion has to be
 * positional for the same reason.
 */
function scoredPairs(mode: 'light' | 'dark'): Array<[Mark, Mark]> {
  const { SERIES, INK_FAINT } = chartTheme(mode)
  const MARKS: Mark[] = [
    ...SERIES.map((hex, i) => ({ hex, label: `S${i}` })),
    { hex: INK_FAINT, label: 'INK_FAINT' },
  ]
  const out: Array<[Mark, Mark]> = []
  for (let i = 0; i < MARKS.length; i++) {
    for (let j = i + 1; j < MARKS.length; j++) out.push([MARKS[i], MARKS[j]])
  }
  return out
}

/**
 * Every pair of the six series and the faint-ink mark — 21 of them.
 *
 * `TOP_N` still appears in the assertions below, but as the premise it always
 * was: a folded pie has to leave one series unused for its "other" wedge. It is
 * no longer part of this arithmetic, because no pair is skipped any more.
 */
const SCORED_PAIR_COUNT = ((SERIES_COUNT + 1) * SERIES_COUNT) / 2

/**
 * The ink tokens that ALSO reach a chart canvas and are deliberately NOT in the
 * scored population — with what the omission costs, measured.
 *
 * This table exists because of how the axis came to be missed: the exclusion was
 * argued once, in a comment, and then nothing measured what it was worth. An
 * omission with a pinned price cannot rot the same way — a palette edit that walks
 * a series into one of these has to come here and restate the number.
 *
 * ⚠️ AND THE FIRST VERSION OF THIS TABLE PRICED THE WRONG THING, because the
 * sentence it was built on was false. It said INK_SOFT's only GRAPHIC use was the
 * KPI target `ReferenceLine` and that "every other use is text". `TrajectoryChart`
 * draws a DATA LINE in it — the counterfactual projection — directly beside a data
 * line in `ACCENT`, which IS `SERIES[0]`, the pair this very table prices at ΔE00
 * 6.56 / ΔL* 0.37 in dark mode. So the exemption was not "a labelled rule beside
 * the series" at all; it was two data lines a dash apart, and nothing asserted
 * that dash: deleting `strokeDasharray="5 5"` from the component left all 808
 * tests green. The three graphic uses are now named here and the second channel of
 * each is read off a RENDERED chart in `palette.recharts.test`, not off this file's
 * own literals handed back to it.
 *
 * `INK_SOFT` — three graphic uses, each carrying a channel besides colour:
 *   1. the KPI target `ReferenceLine` (`targetLine.ts`, in the line, area and bar
 *      widgets) — dash `'6 4'` AND its own word ("Hədəf");
 *   2. `TrajectoryChart`'s counterfactual line — dash `'5 5'` AND a legend name,
 *      against a `realized` line that stays solid;
 *   3. `TrajectoryChart`'s baseline `ReferenceLine` — dash `'4 4'` AND a word.
 * Every other use is text: tick labels, axis titles, `LabelList` values, all
 * scored at 4.5:1 by "INK_SOFT clears AA for text".
 *
 * ⚠️ AND ADOPTING THE RULE IS NOT AVAILABLE, WHICH IS THE HONEST REASON THE LINE
 * IS DRAWN HERE. `SERIES[0]` is frozen to `--accent`, and it measures ΔE00 3.79 /
 * ΔL* 3.65 against light `INK_SOFT` and 6.56 / 0.37 against dark — worse than any
 * pair in the table below. Scoring `INK_SOFT` would fail on a colour no palette
 * re-pick may touch, so the choice is not "score it or be lazy", it is "score it
 * and unfreeze an app-wide token, or state the exemption and measure it".
 *
 * `--ink` — reaches charts only as tooltip TEXT (`tooltipStyle.color` and
 * `tooltipItem`), inside the tooltip box, never as a mark beside a series on the
 * plot. It is listed because the re-picked SERIES[5] sits close to it in both
 * modes and a future reader will wonder whether that was noticed. It was.
 *
 * ⚠️ BOTH METRICS GET THEIR OWN CLOSEST SERIES. The first version measured ΔL*
 * for whichever series won on ΔE00, so a palette edit that walked a DIFFERENT
 * series into the token's lightness would have moved nothing here — in a table
 * whose stated purpose is that such an edit has to come and restate the number.
 * Measured, the two already disagree: light INK_SOFT is closest to S0 in ΔE00
 * (3.79) but to **S2** in lightness (2.61 L*), and 2.61 is under the greyscale
 * floor — a fact the ΔE00-winner's own 3.65 never mentioned.
 */
type PricedInk = { de: [string, number]; dl: [string, number] }
/** The tokens this table must account for — see `holds its own shape`, below. */
const EXEMPT_CANVAS_INK = ['INK_SOFT', 'ink'] as const
const UNSCORED_CANVAS_INK: Record<'light' | 'dark', Record<string, PricedInk>> = {
  // token → closest series by ΔE00, and (separately) closest by ΔL*
  light: {
    INK_SOFT: { de: ['S0', 3.79], dl: ['S2', 2.61] },
    ink: { de: ['S5', 8.50], dl: ['S5', 12.59] },
  },
  dark: {
    INK_SOFT: { de: ['S0', 6.56], dl: ['S0', 0.37] },
    ink: { de: ['S5', 5.48], dl: ['S5', 1.89] },
  },
}

/**
 * The surfaces a chart can sit on, READ OUT of `index.css` rather than copied.
 *
 * A hand-copied table would defeat the point of the assertions below. They
 * exist because the chart palette duplicates CSS tokens (charts cannot resolve
 * custom properties) and duplicates drift; pinning them against a second
 * hand-copy would only catch drift on the chart side, leaving `--surface-2`
 * free to move while every ratio here stayed green against a stale value.
 *
 * `:root` is the light block and `.dark` the dark one; both declare the same
 * names, so the later `.dark` value must not overwrite the earlier `:root` one
 * — hence two scoped slices instead of one flat scan.
 */
function tokens(block: 'light' | 'dark'): Record<string, string> {
  const start = indexCss.indexOf(block === 'light' ? ':root {' : '.dark {')
  if (start === -1) throw new Error(`index.css has no ${block} token block`)
  const slice = indexCss.slice(start, indexCss.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const [, name, r, g, b] of slice.matchAll(
    /(--[\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g,
  )) {
    out[name] = `#${[r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  }
  return out
}

const SURFACE_NAMES = ['--bg', '--surface', '--surface-2'] as const

function backgrounds(mode: 'light' | 'dark'): Array<[string, string]> {
  const t = tokens(mode)
  return SURFACE_NAMES.map((n) => {
    const hex = t[n]
    if (!hex) throw new Error(`index.css ${mode} block is missing ${n}`)
    return [n, hex] as [string, string]
  })
}

describe.each(['light', 'dark'] as const)('HEALTH_COLOR (%s)', (mode) => {
  const HEALTH_COLOR = chartTheme(mode).HEALTH_COLOR

  it('maps every health severity to a hex color', () => {
    const severities: GraphHealthStatus[] = ['ok', 'warn', 'danger', 'unknown']
    for (const s of severities) {
      expect(HEALTH_COLOR[s]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('reuses the app-wide DANGER color for the danger severity', () => {
    // Per-mode now, so the pairing has to hold within a mode — comparing the
    // light ring to the dark danger would pass for the wrong reason.
    expect(HEALTH_COLOR.danger).toBe(chartTheme(mode).DANGER)
  })

  it('reuses the app-wide ACCENT color for the ok severity', () => {
    // The twin of the assertion above, and it was missing — which is how the
    // light side came to read `ok: ACCENT_LIGHT` while the dark side kept a
    // hardcoded #0E9F6E. Pinning SERIES[0] to the accent token widened that into
    // a healthy node ringed in one green while the accent beside it was another.
    // "danger is the token" was asserted; "ok is the token" was only true by
    // habit, in one mode.
    expect(HEALTH_COLOR.ok).toBe(chartTheme(mode).ACCENT)
  })

  it('gives each severity a distinct color', () => {
    const values = Object.values(HEALTH_COLOR)
    expect(new Set(values).size).toBe(values.length)
  })
})

/**
 * The two numbers the axis-color split rests on. Charts do not take CSS custom
 * properties, so these hexes are copies of `--ink-soft` and `--ink-faint` — and
 * a copy drifts silently. These assertions are what make the drift loud.
 */
describe('chart ink measures up to the rule it is used under', () => {
  const MODES = ['light', 'dark'] as const

  /** The SERIES colour with the least room over the 3:1 graphics floor, per mode. */
  const TIGHTEST_CONTRAST: Record<'light' | 'dark', [string, number]> = {
    light: ['S1', 3.94],
    dark: ['S4', 4.04],
  }

  it.each(MODES)('reads the %s surfaces out of index.css', (mode) => {
    // Pinned on the parse, because a regex that quietly matches nothing would
    // leave every ratio below iterating an empty list and passing vacuously.
    const bgs = backgrounds(mode)
    expect(bgs).toHaveLength(3)
    for (const [, hex] of bgs) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    // The two blocks must not resolve to the same colors, or the scan collapsed
    // onto one of them and half these assertions are measuring the wrong mode.
    expect(bgs.map(([, h]) => h)).not.toEqual(backgrounds(mode === 'light' ? 'dark' : 'light').map(([, h]) => h))
  })

  it.each(MODES)('INK_SOFT clears AA for text in %s mode', (mode) => {
    const { INK_SOFT } = chartTheme(mode)
    for (const [name, bg] of backgrounds(mode)) {
      // Measured when written: light 6.52–7.18, dark 5.94–7.21.
      expect(contrastRatio(INK_SOFT, bg), `INK_SOFT on ${name} (${mode})`).toBeGreaterThanOrEqual(TEXT)
    }
  })

  it.each(MODES)('AXIS clears the 3:1 non-text floor in %s mode', (mode) => {
    // AXIS keeps stroking the rules, tick marks and reference lines, so it must
    // stay above the graphics floor — but it is NOT text-safe, which is the
    // whole reason tick labels were moved off it. Measured when written:
    // light 3.24–3.57, dark 3.31–4.02 — over 3, under 4.5, in both modes.
    //
    // ⚠️ This measures the token at full opacity. Two sites used to paint it at
    // 0.5/0.6, which composites to 1.69–2.26 — under the floor while this test
    // stayed green. The opacity was removed rather than the claim softened; if
    // a future site adds it back, this assertion will NOT catch it.
    const { AXIS } = chartTheme(mode)
    for (const [name, bg] of backgrounds(mode)) {
      expect(contrastRatio(AXIS, bg), `AXIS on ${name} (${mode})`).toBeGreaterThanOrEqual(GRAPHIC)
    }
  })

  it.each(MODES)('every SERIES colour clears the graphics floor in %s mode', (mode) => {
    // The defect this whole palette split exists for: every colour used to be
    // shared, every one was tuned on the dark canvas, and 4 of these 6 measured
    // 1.89–2.68 against the light surfaces while passing on dark. A per-mode
    // check is the only kind that would have caught it — a single-mode one was
    // green for as long as the bug existed.
    const { SERIES } = chartTheme(mode)
    expect(SERIES).toHaveLength(SERIES_COUNT)
    const worst: Array<[string, number]> = []
    for (const [i, hex] of SERIES.entries()) {
      for (const [name, bg] of backgrounds(mode)) {
        expect(contrastRatio(hex, bg), `SERIES[${i}] ${hex} on ${name} (${mode})`).toBeGreaterThanOrEqual(GRAPHIC)
      }
      worst.push([`S${i}`, Math.min(...backgrounds(mode).map(([, bg]) => contrastRatio(hex, bg)))])
    }
    // ⚠️ AND THE HEADROOM, PINNED — for the same reason MARGIN exists on the ΔE00
    // side: `>= 3` cannot tell 3.04 from 8. The re-pick had spent most of what was
    // there (light S5 3.12 → 3.04, dark S5 4.63 → 3.24) with no assertion recording
    // that it had moved. Moving S5 off the axis then handed that headroom back and
    // more — it now sits at 10.50 and 11.81, the loudest of the six — so the
    // tightest colour is a different one in each mode, and naming WHICH is half of
    // what this pin is for. A palette edit that puts the neutral back in the band
    // it left has to restate this line.
    const tightest = worst.reduce((a, b) => (b[1] < a[1] ? b : a))
    const [cKey, cVal] = TIGHTEST_CONTRAST[mode]
    expect.soft(tightest[0], `${mode}: a different colour is now the tightest`).toBe(cKey)
    expect.soft(tightest[1], `${mode}: the tightest colour's contrast moved`).toBeCloseTo(cVal, 2)
  })

  it.each(MODES)('DANGER clears the graphics floor in %s mode', (mode) => {
    const { DANGER } = chartTheme(mode)
    for (const [name, bg] of backgrounds(mode)) {
      expect(contrastRatio(DANGER, bg), `DANGER on ${name} (${mode})`).toBeGreaterThanOrEqual(GRAPHIC)
    }
  })

  it.each(MODES)('every graph node colour clears BOTH its floors in %s mode', (mode) => {
    // Two constraints pulling opposite ways: light enough to carry the near-black
    // GLYPH, dark enough to sit on the canvas. Checking only one of them is how
    // `ds` nearly shipped as the --accent token, which reads 2.77 under a glyph.
    //
    // Scored against ALL THREE surfaces, not the canvas alone. Unlike the health
    // ring these colours leave the graph: the same hue is a legend chip and a
    // panel header on `--surface-2` (GraphCanvas) and a row marker in the asset
    // picker. Canvas-only scoring reported `column` at 3.44 when its real worst
    // case is 3.12 — still over the floor, but with a quarter of the headroom
    // the number implied, and a regression there was invisible.
    const { GRAPH_TYPE_COLORS } = chartTheme(mode)
    expect(Object.keys(GRAPH_TYPE_COLORS)).toEqual(GRAPH_TYPES)
    for (const [type, hex] of Object.entries(GRAPH_TYPE_COLORS)) {
      for (const [name, bg] of backgrounds(mode)) {
        expect(contrastRatio(hex, bg), `${type} ${hex} on ${name} (${mode})`).toBeGreaterThanOrEqual(GRAPHIC)
      }
      expect(contrastRatio(hex, GLYPH), `${type} ${hex} under the glyph (${mode})`).toBeGreaterThanOrEqual(GRAPHIC)
    }
  })

  it.each(MODES)('INK_FAINT clears the graphics floor in %s mode', (mode) => {
    // The one colour this palette added without a floor. It is not decoration:
    // it fills the folded "other" wedge in PieChartWidget and DonutPreview, a
    // mark that carries a share of the data and is named in the legend.
    // Measured worst-of-three: 3.24 light, 3.31 dark — 8% and 10% of headroom,
    // which is exactly the margin that disappears without anyone noticing.
    const { INK_FAINT } = chartTheme(mode)
    for (const [name, bg] of backgrounds(mode)) {
      expect(contrastRatio(INK_FAINT, bg), `INK_FAINT on ${name} (${mode})`).toBeGreaterThanOrEqual(GRAPHIC)
    }
  })

  it.each(MODES)('INK_FAINT is the --ink-faint token in %s mode', (mode) => {
    // Same rationale as the ACCENT/DANGER pin below: it is an uncommitted copy
    // of a token it happens to equal today (140 135 126 / 124 118 110). Free to
    // drift tomorrow, and the drift would be invisible — the two are only ever
    // seen in different places, so nothing on screen would look wrong.
    expect(chartTheme(mode).INK_FAINT.toLowerCase()).toBe(tokens(mode)['--ink-faint'])
  })

  it.each(MODES)('prices the ink tokens it leaves out of the scored set in %s mode', (mode) => {
    // The exemption, measured. See UNSCORED_CANVAS_INK for why each is out.
    //
    // ⚠️ THE TABLE'S OWN SHAPE IS ASSERTED FIRST, and that is not ceremony: this
    // loop iterates the register's entries, so an EMPTIED register runs zero
    // iterations and passes — which is precisely the property `DEBT` was deleted
    // rather than emptied over, rebuilt one screen up in the same file. Measured:
    // `light: {}` left all 220 chart tests green.
    expect(Object.keys(UNSCORED_CANVAS_INK[mode]).sort(), `${mode}: the exemption register changed shape`)
      .toEqual([...EXEMPT_CANVAS_INK].sort())
    const t = chartTheme(mode)
    const tokenHex: Record<string, string> = { INK_SOFT: t.INK_SOFT, ink: tokens(mode)['--ink'] }
    for (const [name, { de, dl }] of Object.entries(UNSCORED_CANVAS_INK[mode])) {
      const hex = tokenHex[name]
      expect(hex, `${mode}: no hex for ${name}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
      const rows = t.SERIES.map(
        (s, i) => [`S${i}`, worstOf(s, hex)[1], Math.abs(lightness(s) - lightness(hex))] as const,
      )
      // Two reductions, one per metric: they pick different series (light INK_SOFT
      // is nearest S0 in ΔE00 and S2 in lightness), and reading ΔL* off the ΔE00
      // winner left the lightness half of this register unable to move.
      const nearestDE = rows.reduce((a, b) => (b[1] < a[1] ? b : a))
      const nearestDL = rows.reduce((a, b) => (b[2] < a[2] ? b : a))
      expect.soft(nearestDE[0], `${mode}: a different series is now closest to ${name} in ΔE00`).toBe(de[0])
      expect.soft(nearestDE[1], `${mode}: ${name} vs ${nearestDE[0]} moved in ΔE00`).toBeCloseTo(de[1], 1)
      expect.soft(nearestDL[0], `${mode}: a different series is now closest to ${name} in ΔL*`).toBe(dl[0])
      expect.soft(nearestDL[2], `${mode}: ${name} vs ${nearestDL[0]} moved in ΔL*`).toBeCloseTo(dl[1], 1)
    }
  })

  it('draws no graphic mark in the exempt ink that this file has not priced', () => {
    // WHY A SOURCE SCAN. The register above is only honest while it names every
    // place the exempt ink reaches a canvas, and the way it stopped being honest
    // was silent: `TrajectoryChart` had been stroking a DATA LINE in INK_SOFT the
    // whole time while this file's docstring said the target rule was the only
    // graphic use. Nothing measured the claim, so nothing reported it.
    //
    // A stroke is the tell: in this codebase text is `fill`ed and never stroked,
    // so `stroke={…INK_SOFT}` is exactly the set of graphic marks drawn in it. A
    // new one has to be added here — and, being a mark beside a series, priced.
    const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true })
    const drawn: string[] = []
    for (const [path, src] of Object.entries(sources as Record<string, string>)) {
      if (path.includes('.test.')) continue
      const hits = (src.match(/stroke=\{[^}]*INK_SOFT[^}]*\}/g) ?? []).length
      if (hits) drawn.push(`${path.replace('../', '')} ×${hits}`)
    }
    // Positive control: the scan has to be able to see something, or an expression
    // that matched nothing would agree with any list at all.
    expect(drawn.length, 'the source scan found no stroked INK_SOFT at all').toBeGreaterThan(0)
    expect(drawn.sort(), 'a graphic mark is drawn in exempt ink that is not priced above').toEqual([
      // The counterfactual line and the baseline rule — uses 2 and 3 above.
      'decision/TrajectoryChart.tsx ×2',
    ])
  })

  it('keeps the dash the target line is exempt on the strength of', () => {
    // What `targetLine.ts` itself contributes to the exemption — the dash, which is
    // the module's own constant. The WORD and the INK come from the three widgets
    // that call it, so they are asserted where they are chosen: on a rendered chart
    // in `palette.recharts.test`. Calling this helper with literals and asserting
    // they come back — which is what stood here — holds for any function that
    // forwards its arguments, and measured, all three widgets could be changed to
    // pass an EMPTY label with the whole suite green.
    //
    // `toBeTruthy` stood here too, and `'0'` satisfies it while painting an
    // unbroken line. `inkFraction` is the quantity a dash IS: solid reads 1, and an
    // all-zero pattern throws rather than passing quietly.
    const props = targetLineProps('Hədəf', chartTheme('light').INK_SOFT)
    expect(inkFraction(props.strokeDasharray), 'the target line lost its dash').toBeLessThan(1)
  })

  it.each(MODES)('AXIS and INK_FAINT are one mark in %s mode', (mode) => {
    // What licenses `scoredPairs` scoring a single faint-ink mark for two roles.
    // The pie's "other" wedge and the axis rule are the same hex today, so one
    // entry covers both; if they ever diverge, the population above silently
    // stops scoring the axis against anything — every series would be measured
    // against the wedge alone, which is the narrower of the two claims. This
    // fails first and says which.
    const { AXIS, INK_FAINT } = chartTheme(mode)
    expect(AXIS, `${mode}: AXIS and INK_FAINT have diverged — scoredPairs must now carry both marks`)
      .toBe(INK_FAINT)
  })

  it.each(MODES)('every health ring clears the floor AS COMPOSITED in %s mode', (mode) => {
    const { HEALTH_COLOR, SURFACE } = chartTheme(mode)
    for (const [status, hex] of Object.entries(HEALTH_COLOR)) {
      const painted = composite(hex, SURFACE, RING_OPACITY)
      expect(contrastRatio(painted, SURFACE), `${status} ring (${mode}) painted ${painted}`).toBeGreaterThanOrEqual(GRAPHIC)
    }
  })

  it('draws the health ring at the opacity this file scores it at', () => {
    // The composites above are only true at RING_OPACITY, so the ring has to be
    // painted at exactly that. Sharing the constant is what enforces it now;
    // this asserts the sharing is still in place.
    //
    // ⚠️ The previous version interpolated the NUMBER into a regex and searched
    // for its shape: `opacity=\{dimmed \? [\d.]+ : 0.9\}`. Two ways to be green
    // while wrong — the `.` in `0.9` was an unescaped wildcard, and a match
    // anywhere in the file counted, so any other element wearing that shape
    // would satisfy it while the ring itself moved to 0.6. A literal is not a
    // cleverer regex; it is one that cannot drift.
    //
    // ⚠️ AND THE LITERAL IT PINNED WAS `opacity={dimmed ? 0.4 : RING_OPACITY}` —
    // i.e. this guard read the defect every run and reported green, because it
    // only ever asked whether the UNDIMMED branch matched what the composites
    // above score. The dimmed branch composited to 1.63–2.40. Grepping the source
    // cannot see that; `ForceGraph.test` now renders the dimmed state and reads
    // the opacity off the DOM, which is the assertion that actually binds. What
    // is left here is the weaker half, kept only because it is free.
    expect(forceGraphSrc.length, 'ForceGraph source did not resolve').toBeGreaterThan(1000)
    expect(forceGraphSrc).toContain('opacity={RING_OPACITY}')
    expect(forceGraphSrc, 'RING_OPACITY must come from the theme, not a local').toMatch(
      /import \{[^}]*\bRING_OPACITY\b[^}]*\} from '\.\.\/charts\/theme'/,
    )
  })

  it.each(MODES)('keeps every ring SEVERITY separable in %s mode', (mode) => {
    // The invariant, stated as the disjunction it actually is: two severities may
    // share a dash pattern only if colour alone already separates them for every
    // reader, and may collide in colour only if the dash tells them apart. Either
    // channel satisfies it; needing neither is what a colour-only ring was.
    //
    // Written this way on purpose. Asserting "warn and danger have different
    // dashes" would pin today's ANSWER and force the dash to survive a future
    // repalette that made it unnecessary; asserting "all pairs clear SEPARATION"
    // would fail on a defect that is already closed by other means. This asks the
    // question instead, so it stays true under both futures and goes red only
    // when severity genuinely becomes unreadable.
    //
    // ⚠️ AND ON ITS OWN IT WAS DECORATIVE. `RING_DASH` is injective, so
    // `dashDiffers` is unconditionally true and the ΔE operand never ran:
    // measured, replacing SEPARATION with 1e9 right here left the file green,
    // and `composite`, `deltaE2000` and `simulateDichromacy` were all imported,
    // computed, and discarded. The disjunction is still the honest statement of
    // the invariant, so it stays — but the colour half is now pinned by the test
    // BELOW, which asserts the measured separations instead of narrating them.
    const { HEALTH_COLOR, SURFACE } = chartTheme(mode)
    for (const [a, b] of PAIRS) {
      const [pa, pb] = [
        composite(HEALTH_COLOR[a], SURFACE, RING_OPACITY),
        composite(HEALTH_COLOR[b], SURFACE, RING_OPACITY),
      ]
      const [, worst] = worstOf(pa, pb)
      const dashDiffers = RING_DASH[a] !== RING_DASH[b]
      expect(
        dashDiffers || worst >= SEPARATION,
        `${a} vs ${b} (${mode}): worst ΔE ${worst.toFixed(2)} and both dashed "${RING_DASH[a]}" — ` +
          'severity has no channel left',
      ).toBe(true)
    }
  })

  /**
   * What the disjunction above leans on, as numbers rather than as prose.
   *
   * Every one of these was quoted in a docstring and asserted nowhere, which is
   * the exact shape the dichromacy work already got caught by: the simulator was
   * anchored and the metric consuming it was not, so swapping CIELAB for plain
   * sRGB distance broke every figure and not one test noticed. Pinning the
   * measurements makes `composite`, `deltaE2000` and `simulateDichromacy`
   * load-bearing on this path — and makes a repalette announce itself here, where
   * the comments explaining WHY the dash exists live, instead of silently
   * invalidating them.
   *
   * ⚠️ ALL SIX MOVED WHEN THE MODEL DID, and only two of them were visible: the
   * loop below used to throw on the first failing pair, so a table with six wrong
   * rows reported as one. Four of the six had gone stale unnoticed — `danger`
   * /`unknown` in light was 18.08 under protanopia and is 14.78 under
   * DEUTERANOPIA, and both `warn`/`unknown` rows were "worst in normal vision",
   * which was never plausible for a pair a dichromat has to work harder at. Hence
   * `expect.soft`: one run now names every row that is wrong.
   *
   * Read it as: `danger`/`warn` is the pair the dash carries — 4.50 in light,
   * against a floor of 10 — while dark `danger`/`unknown` at 7.20 is the second
   * reason all three severities keep their own dash. The 1997 model made that case
   * STRONGER than the cautious one the last PR argued from, not weaker.
   */
  const WORST: Record<'light' | 'dark', Record<string, [number, Dichromacy | 'none']>> = {
    light: {
      'danger/warn': [4.5, 'deutan'],
      'danger/unknown': [14.78, 'deutan'],
      'warn/unknown': [13.3, 'tritan'],
    },
    dark: {
      'danger/warn': [9.39, 'deutan'],
      'danger/unknown': [7.2, 'protan'],
      'warn/unknown': [17.65, 'tritan'],
    },
  }

  it.each(MODES)('measures the ring separations its comments quote in %s mode', (mode) => {
    const { HEALTH_COLOR, SURFACE } = chartTheme(mode)
    for (const [a, b] of PAIRS) {
      const [pa, pb] = [
        composite(HEALTH_COLOR[a], SURFACE, RING_OPACITY),
        composite(HEALTH_COLOR[b], SURFACE, RING_OPACITY),
      ]
      // ⚠️ LOOKED UP BEFORE IT IS DESTRUCTURED. `PAIRS` is derived from
      // `RING_DASH`, so adding a fourth ringed severity is an expected change —
      // and a bare `const [x, y] = WORST[mode][key]` would then throw "undefined
      // is not iterable" on the first new pair, hiding the other five. That is the
      // same first-throw-hides-the-rest failure this file just fixed elsewhere.
      const row = WORST[mode][`${a}/${b}`]
      const [actualCondition, worst] = worstOf(pa, pb)
      if (!row) {
        expect.soft(row, `${a}/${b} (${mode}) has no recorded separation — measured ${worst.toFixed(2)} under ${actualCondition}`).toBeDefined()
        continue
      }
      const [expected, condition] = row
      expect.soft(worst, `${a}/${b} (${mode})`).toBeCloseTo(expected, 1)
      // Not just the number but WHICH reader is worst off — a metric that drifted
      // while happening to land on the same figure would still be caught, and the
      // condition is the half the prose is actually about.
      expect.soft(actualCondition, `${a}/${b} (${mode}) worst condition`).toBe(condition)
    }
  })

  /**
   * WHAT THE PALETTE ACHIEVES, pinned — and the reason the DEBT table that used to
   * stand here is gone rather than merely emptied.
   *
   * THAT TABLE NAMED 14 PAIRS under `SEPARATION`, on the precedent
   * `theme.contrast.test` set with its `<=16` lock, and its set-equality assertion
   * was what made the floor load-bearing: `below` had to equal the recorded keys, so
   * moving `SEPARATION` changed `below` and went red. Emptying it silently removed
   * that property — `[] === []` holds for any floor — which is measured in
   * `FLOOR_PROBES` above and is why the digits are now held there instead. An empty
   * register that reads as a ratchet but is not one is worse than no register.
   *
   * ⚠️ AND AN INEQUALITY CANNOT TELL 12.21 FROM 40. The loop below asserts
   * `>= SEPARATION`, so a metric that drifted upward, a simulator that got weaker,
   * or a palette edit that quietly spent all its margin all keep it green. So the
   * closest pairs of each mode are pinned by NAME, VALUE and WORST READER.
   *
   * ⚠️ NAME IS A **SET**, because pairs sit closer to each other than the value
   * pin's own tolerance. Measured on the shipped light set, the three tightest are
   * S2/S5 12.1229, S3/S5 12.1606 and S0/S1 12.2076, and in greyscale S3/S5 5.0415,
   * S1/S4 5.0516 and S0/S4 5.0662 — 0.010 apart in the second case, against a
   * `toBeCloseTo(_, 1)` window of 0.05. Pinning a single winner there is a tripwire
   * that one 8-bit nudge or one float-order change flips, with no accessibility
   * meaning; pinning everything within `TIE` of the minimum says what is actually
   * true, and still fails when a genuinely different pair becomes the weakest.
   *
   * ⚠️ AND THE VALUE AND READER HAVE TO COME FROM THE SET TOO, which they did not
   * at first: they were read off the single strict minimum, so the tripwire the
   * name pin had just removed was still live one line down. Light's tied three
   * include S0/S1 at 12.2076 under PROTANOPIA where the other two are tritan —
   * a reordering would have failed both `toBeCloseTo(12.12, 1)` and `toBe('tritan')`
   * while `tiedAt` stayed green. The value and the reader are now taken from the
   * tied SET: the minimum with a tolerance covering the whole tie window, and the
   * conditions as a set.
   *
   * These are measured, not chosen: `T = 12` was used while searching so the shipped
   * palette would not sit on the floor it is graded against, and this is where that
   * air is recorded. Light 12.12 and dark 12.01 against a floor of 10.
   */
  /**
   * How far past the minimum still counts as tied — one per metric, because they
   * are measured on different scales and the pairs bunch differently.
   *
   * ⚠️ THE WIDTH IS CHOSEN SO THE BOUNDARY LANDS IN A GAP, which the single 0.1
   * did not: light's ΔE00 pairs run 12.123, 12.161, 12.208, 12.275, 12.650, 12.847
   * then jump to 14.319, so a 0.1 window cut the run at 12.2229 with the next pair
   * only 0.052 outside — a membership rule one nudge from admitting a fourth name
   * for no accessibility reason, i.e. the tripwire the set pin exists to avoid,
   * relocated to the set's edge. 0.2 on ΔE00 and 0.1 on ΔL* leave gaps of 0.33 /
   * 0.74 and 0.44 / 0.30 after the cutoff, and `GAP` below asserts they are still
   * there rather than trusting today's spacing.
   */
  const TIE = { sep: 0.2, grey: 0.1 } as const
  /** The clear water a tie window must have after it, so membership is not a coin flip. */
  const GAP = 0.25
  /**
   * The straddles that hold `TIE` and `GAP` to their digits — the same argument
   * as `FLOOR_PROBES`, for the same reason, found the same way.
   *
   * ⚠️ THESE TWO WERE FLOOR-SHAPED CONSTANTS THAT NOTHING READ. Every assertion
   * they appear in is an inequality pointing one way, so lowering them is
   * invisible: measured, `GAP = 0` and `TIE.grey = 0.05` each left all 220 chart
   * tests green — `gapAfter(...) >= 0` is true of any table at all, and a smaller
   * tie window simply names fewer pairs, which the pins then agree with. Only
   * `TIE.sep` was anchored, and only by the accident that light's tied set happens
   * to shrink from four names to three at 0.1.
   *
   * ⚠️ AND THE NUMBERS HERE ARE ABSOLUTE, NOT DERIVED FROM THE CONSTANTS. A probe
   * built as `TIE - 0.01` moves with the thing it is supposed to pin and cannot
   * fail — the self-pinning helper this repo has already shipped twice.
   */
  const WINDOW_PROBES = {
    // A synthetic score table: the second row must land INSIDE the tie window and
    // the third OUTSIDE it, which fails if the window moves in either direction.
    tie: { sep: { inside: 0.19, outside: 0.21 }, grey: { inside: 0.09, outside: 0.11 } },
    // Clear water after the cutoff: 0.24 must be judged too tight, 0.26 wide enough.
    gap: { under: 0.24, over: 0.26 },
  } as const
  const MARGIN: Record<'light' | 'dark', {
    sep: [string[], number, Array<Dichromacy | 'none'>]
    grey: [string[], number]
  }> = {
    light: {
      sep: [['S0/S1', 'S0/S2', 'S2/S5', 'S3/S5'], 12.12, ['protan', 'tritan']],
      grey: [['S0/S4', 'S1/S4', 'S3/S5'], 5.04],
    },
    dark: { sep: [['S1/S5'], 12.01, ['deutan']], grey: [['S1/S5'], 5.11] },
  }

  it.each(MODES)('excuses no pair from the scored set in %s mode', (mode) => {
    // ⚠️ THE SIZE PIN ALONE DOES NOT HOLD THIS, and that was measured rather than
    // feared: restoring the S5/INK_FAINT exclusion AND `SCORED_PAIR_COUNT` together
    // — which is what a consistent revert looks like — left all 49 tests green.
    // The MARGIN pins do not notice either, because the closest pairs in both modes
    // are SERIES/SERIES ones that stay scored either way. So the defect this file
    // was changed to catch could walk straight back in through the tidy edit.
    //
    // A degree count is a different construction from the loop that builds the
    // pairs, which is the point: every one of the seven marks must be scored
    // against all six others, so dropping ANY pair takes two of them to five and
    // fails here whatever the total is edited to say.
    const pairs = scoredPairs(mode)
    const degree = new Map<string, number>()
    for (const [A, B] of pairs) {
      for (const m of [A, B]) degree.set(m.label, (degree.get(m.label) ?? 0) + 1)
    }
    const marks = [...Array(SERIES_COUNT).keys()].map((i) => `S${i}`).concat('INK_FAINT')
    for (const label of marks) {
      expect.soft(degree.get(label), `${mode}: ${label} is not scored against every other mark`)
        .toBe(marks.length - 1)
    }
    // Named separately because it is the pair that was excused, and the reason it
    // was — a folded pie never paints SERIES[5] — is true of the pie and silent
    // about the axis, which wears the same hex. See `scoredPairs`.
    const keys = pairs.map(([A, B]) => `${A.label}/${B.label}`)
    expect(keys, `${mode}: S5 must be scored against the faint-ink mark (it IS the axis rule)`)
      .toContain(`S${SERIES_COUNT - 1}/INK_FAINT`)
  })

  /** Everything within `tie` of the smallest score, sorted — the pinned identity. */
  const tiedAt = (rows: Array<[string, number]>, tie: number) => {
    const min = Math.min(...rows.map(([, v]) => v))
    return rows.filter(([, v]) => v <= min + tie).map(([k]) => k).sort()
  }

  /** Distance from the tie cutoff to the nearest score OUTSIDE it, or Infinity. */
  const gapAfter = (rows: Array<[string, number]>, tie: number) => {
    const cutoff = Math.min(...rows.map(([, v]) => v)) + tie
    const outside = rows.map(([, v]) => v).filter((v) => v > cutoff)
    return outside.length ? Math.min(...outside) - cutoff : Infinity
  }

  it.each(MODES)('keeps every SERIES pair apart without hue in %s mode', (mode) => {
    // The assertion this palette exists for, and the one its predecessor failed
    // silently: a chart may put ANY two series side by side, so all 15 pairs are
    // scored — not only lightness neighbours — and scored again as each of the
    // three dichromacies sees them.
    //
    // WHY THIS REPLACED A LUMINANCE-GAP CHECK. The old test asserted a 0.02 gap
    // between sorted luminance neighbours, in light mode only. It was the right
    // instinct measured on the wrong quantity, and it was green while the dark
    // palette had a pair at ΔE 2.2 under deuteranopia — indistinguishable.
    // A gap between NEIGHBOURS says nothing about the pair two steps apart, and
    // relative luminance is not perceptual, so a "legal" gap at one end of the
    // scale is a much smaller difference than the same gap at the other.
    //
    // ⚠️ WHAT THIS FLOOR DOES NOT DO IS SUBSUME A LIGHTNESS ONE, which an earlier
    // draft of this comment claimed on the reasoning that "two colours cannot
    // clear 10 ΔE for a deuteranope without a real lightness difference, because
    // that reader has nothing else to go on". Measured, that is false. The set two
    // generations back had SERIES[1] #009562 and SERIES[4] #9776B3 sitting 0.4 L*
    // apart while scoring ΔE00 28.9 under deuteranopia, and the palette in this
    // file still shows the effect: S1/S4 clears the lightness floor by 0.55 and
    // scores 40.5 under deuteranopia. A deuteranope has plenty to go on —
    // deuteranopia deletes red-green and leaves blue-yellow standing, and
    // green-vs-violet rides that surviving axis.
    //
    // So the two properties are INDEPENDENT, not nested, and both are now asserted:
    // this test owns ΔE00 under simulated vision, and the greyscale test below owns
    // ΔL*. Neither may be dropped on the grounds that the other passes.
    expect(chartTheme(mode).SERIES).toHaveLength(SERIES_COUNT)
    expect(TOP_N, 'a folded pie must leave one series unused for the other wedge')
      .toBeLessThanOrEqual(SERIES_COUNT - 1)
    // ONE call, then assert and iterate the SAME array. Calling `scoredPairs` twice
    // meant the length assertion spoke for a different object than the loop scored —
    // harmless while the helper is pure, and exactly the kind of "harmless" that
    // stops being true after someone adds caching or ordering to it. Both floors
    // read this helper, so a version returning fewer pairs — or none — would weaken
    // two tests at once and leave both green.
    const pairs = scoredPairs(mode)
    expect(pairs, `${mode}: the scored population changed size`).toHaveLength(SCORED_PAIR_COUNT)

    const below: string[] = []
    const scores: Array<[string, number]> = []
    /** Which reader saw each pair worst — kept so MARGIN can pin them as a set. */
    const conditionOf = new Map<string, Dichromacy | 'none'>()
    for (const [A, B] of pairs) {
      const key = `${A.label}/${B.label}`
      const [condition, worst] = worstOf(A.hex, B.hex)
      conditionOf.set(key, condition)
      const where = `${A.label} ${A.hex} vs ${B.label} ${B.hex} (${mode}), worst under ${condition}`
      expect.soft(worst, `${where} — under the floor`).toBeGreaterThanOrEqual(SEPARATION)
      if (worst < SEPARATION) below.push(key)
      scores.push([key, worst])
    }
    // The aggregate form of the same claim, so one run names every offender rather
    // than leaving the reader to collect them from soft failures.
    expect(below.sort(), `${mode}: these pairs are under the floor`).toEqual([])

    // …and the margin the palette was searched for. `below` being empty says
    // "nothing is under 10"; this says how far over 10 the closest pairs actually
    // are, which is the number that erodes first when someone nudges a colour.
    // No "was anything scored at all?" guard here: `toHaveLength(SCORED_PAIR_COUNT)`
    // above is that assertion, and a hard one. The accumulator that used to carry
    // this was written for the strict-minimum version of the pins and outlived it —
    // its value and its reader are both recomputed from `scores` below.
    const [mKeys, mVal, mConds] = MARGIN[mode].sep
    const tied = tiedAt(scores, TIE.sep)
    expect.soft(tied, `${mode}: a different pair is now the closest`).toEqual([...mKeys].sort())
    expect.soft(gapAfter(scores, TIE.sep), `${mode}: the tie window has no clear water after it`)
      .toBeGreaterThanOrEqual(GAP)

    // The value is bounded on BOTH sides rather than pinned to the strict minimum:
    // it may not drop (that is the palette eroding, which is what this records) and
    // it may not rise past the tie window either, since that means the tied set
    // changed and the name pin above should have caught it. Pinning the minimum
    // exactly would fail on a reordering INSIDE the window — 12.123 and 12.208 are
    // both "the closest pair" to within the tie — which is the tripwire the set
    // pin was introduced to remove.
    const min = Math.min(...scores.map(([, v]) => v))
    expect.soft(min, `${mode}: the closest pair got closer than the pinned ${mVal}`)
      .toBeGreaterThanOrEqual(mVal - 0.05)
    expect.soft(min, `${mode}: the closest pair moved out of its own tie window`)
      .toBeLessThanOrEqual(mVal + TIE.sep)

    // Readers as a SET, for the same reason: light's tied pairs are read worst by
    // two different dichromats, and which one happens to sort first is not a fact
    // about the palette.
    const readers = [...new Set(scores.filter(([k]) => tied.includes(k)).map(([k]) => k)
      .map((k) => conditionOf.get(k)!))].sort()
    expect.soft(readers, `${mode}: the closest pairs changed reader`).toEqual([...mConds].sort())
  })

  it('holds each floor to the digit it is written as', () => {
    // ⚠️ THE ONLY ASSERTIONS IN THIS FILE THAT READ THE FLOORS THEMSELVES, and they
    // exist because their absence was measured: with the palette clean, `SEPARATION`
    // could be moved 10 → 1 and `GREYSCALE` 4.5 → 0.5 with all 45 tests green. Every
    // other assertion about a floor is an inequality pointing one way, and a palette
    // that clears 10 clears 1 just as well.
    //
    // Each probe is a pair of greys straddling the digit: the "under" one must be
    // judged under, the "over" one must pass. Move the floor in either direction and
    // one of the four fails. Values are pinned too, so a metric change has to
    // restate them here rather than re-scale both sides unnoticed.
    // `expect.soft` throughout, for the reason this file states three times over:
    // a hard throw on the first probe reports one row of a four-row table, so a
    // metric change that re-scaled both probes would hide its second half — and a
    // `GREYSCALE` edit would never report at all, the separation loop having
    // thrown first.
    const { separation, greyscale } = FLOOR_PROBES
    for (const [side, [a, b, expected]] of Object.entries(separation)) {
      const [, measured] = worstOf(a, b)
      expect.soft(measured, `${a}/${b} is the ΔE00 ${side} probe`).toBeCloseTo(expected, 1)
      if (side === 'under') expect.soft(measured, `${a}/${b} must read as under the floor`).toBeLessThan(SEPARATION)
      else expect.soft(measured, `${a}/${b} must clear the floor`).toBeGreaterThanOrEqual(SEPARATION)
    }
    for (const [side, [a, b, expected]] of Object.entries(greyscale)) {
      const measured = Math.abs(lightness(a) - lightness(b))
      expect.soft(measured, `${a}/${b} is the ΔL* ${side} probe`).toBeCloseTo(expected, 1)
      if (side === 'under') expect.soft(measured, `${a}/${b} must read as under the floor`).toBeLessThan(GREYSCALE)
      else expect.soft(measured, `${a}/${b} must clear the floor`).toBeGreaterThanOrEqual(GREYSCALE)
    }
  })

  it('holds the tie window and its clear-water rule to the digits they are written as', () => {
    // The same construction as the floor probes, on the two constants that decide
    // WHICH pairs get pinned rather than how far apart they must be. See
    // WINDOW_PROBES for what each of these was measured to allow before it existed.
    for (const metric of ['sep', 'grey'] as const) {
      const { inside, outside } = WINDOW_PROBES.tie[metric]
      const rows: Array<[string, number]> = [['A', 10], ['B', 10 + inside], ['C', 10 + outside]]
      expect.soft(tiedAt(rows, TIE[metric]), `TIE.${metric} no longer cuts between ${inside} and ${outside}`)
        .toEqual(['A', 'B'])
    }
    // GAP is read through `gapAfter`, so the probe runs through it too: a table
    // with less clear water than the rule requires must FAIL the rule, and one
    // with more must satisfy it. The first line is what `GAP = 0` cannot survive.
    const tight: Array<[string, number]> = [['A', 10], ['B', 10 + TIE.sep + WINDOW_PROBES.gap.under]]
    expect.soft(gapAfter(tight, TIE.sep), `${WINDOW_PROBES.gap.under} of water must be too little`)
      .toBeLessThan(GAP)
    const loose: Array<[string, number]> = [['A', 10], ['B', 10 + TIE.sep + WINDOW_PROBES.gap.over]]
    expect.soft(gapAfter(loose, TIE.sep), `${WINDOW_PROBES.gap.over} of water must be enough`)
      .toBeGreaterThanOrEqual(GAP)
  })

  it('measures lightness rather than returning a number that looks like one', () => {
    // The greyscale floor's real positive control, and it is NOT the
    // `|L(x) - L(x)| === 0` this file tried first: that is a tautology for any pure
    // function, so a `lightness` stubbed to return 42 passed it — and passed the
    // "control pair must fail the floor" line too, since |42-42| = 0 is under 4.5.
    // Both controls were green while the measure was a constant. These two anchor
    // the ends of the scale instead, which no constant can satisfy.
    expect(lightness('#000000'), 'black must sit at the bottom of L*').toBeCloseTo(0, 1)
    expect(lightness('#FFFFFF'), 'white must sit at the top of L*').toBeCloseTo(100, 1)

    // …and the pair the palette two generations back collided on, pinned by value:
    // it must FAIL the lightness floor while PASSING the ΔE00 one, which is the
    // whole reason greyscale is asserted separately at all.
    const [A, B] = ['#009562', '#9776B3']
    expect(Math.abs(lightness(A) - lightness(B)), 'the control pair is 0.43 L* apart')
      .toBeCloseTo(0.43, 1)
    expect(Math.abs(lightness(A) - lightness(B)), 'the control pair must FAIL the greyscale floor')
      .toBeLessThan(GREYSCALE)
    expect(worstOf(A, B)[1], 'the control pair must PASS the ΔE00 floor while failing that one')
      .toBeGreaterThanOrEqual(SEPARATION)
  })

  it.each(MODES)('keeps every SERIES pair apart in greyscale too in %s mode', (mode) => {
    // The assertion no dichromacy model above can make, because every one of them
    // PRESERVES lightness: a photocopy, a greyscale print, a monochrome e-ink
    // reader and full achromatopsia all keep L* and delete everything else.
    //
    // The measure itself, and the pair that proves this floor reaches a reader the
    // ΔE00 one does not, are anchored in their own test above — mode-invariant
    // claims do not belong inside a per-mode `each`, where one defect reports as two.
    const pairs = scoredPairs(mode)
    expect(pairs, `${mode}: the scored population changed size`).toHaveLength(SCORED_PAIR_COUNT)

    const gaps: Array<[string, number]> = []
    for (const [A, B] of pairs) {
      const gap = Math.abs(lightness(A.hex) - lightness(B.hex))
      // `expect.soft`, like the loop above: a hard throw on the first collision
      // reports a twenty-row table as one row, which this file has already been
      // caught by once.
      expect.soft(
        gap,
        `${A.label} ${A.hex} vs ${B.label} ${B.hex} (${mode}) — ΔL* ${gap.toFixed(2)}, they photocopy to the same grey`,
      ).toBeGreaterThanOrEqual(GREYSCALE)
      gaps.push([`${A.label}/${B.label}`, gap])
    }
    // The same pin the ΔE00 side uses, minus the reader: greyscale has only one.
    // Without it, `>= 4.5` cannot tell 5.05 from 40 — and 5.05 is the number that
    // erodes first, since it is the one the search bought last.
    const [gKeys, gVal] = MARGIN[mode].grey
    expect.soft(tiedAt(gaps, TIE.grey), `${mode}: a different pair is now the closest in greyscale`)
      .toEqual([...gKeys].sort())
    expect.soft(gapAfter(gaps, TIE.grey), `${mode}: the greyscale tie window has no clear water after it`)
      .toBeGreaterThanOrEqual(GAP)
    // Bounded both ways, like the ΔE00 side and for the same reason.
    const gMin = Math.min(...gaps.map(([, v]) => v))
    expect.soft(gMin, `${mode}: the closest greyscale pair got closer than the pinned ${gVal}`)
      .toBeGreaterThanOrEqual(gVal - 0.05)
    expect.soft(gMin, `${mode}: the closest greyscale pair moved out of its own tie window`)
      .toBeLessThanOrEqual(gVal + TIE.grey)
  })

  it.each(MODES)('keeps the SERIES span the mode-split was justified by in %s mode', (mode) => {
    // The deleted luminance-neighbour check took a second assertion down with it:
    // theme.ts still argues the split is worth it because each set spans further
    // than the 1.50:1 a shared palette is capped at, and quotes 2.67:1 and 2.93:1.
    // Those are load-bearing numbers, so both the floor AND the achieved value are
    // asserted — `> 1.5` alone cannot tell 2.67 from 12, and the comment it is
    // holding honest names a specific figure, not an inequality.
    //
    // ⚠️ Deliberately NOT a neighbour-gap check, and the shipped set is now the
    // proof rather than an argument: its smallest luminance gap is 0.0175 (light),
    // which FAILS the 0.02 the deleted test demanded, while every pair — including
    // the ones two steps apart, which that test never looked at — clears ΔL* 4.5
    // above. A set can be worse by the old measure and better by the one that
    // reaches the reader. That is what "wrong quantity, not too low a threshold"
    // means, stated in numbers.
    // Compared ROUNDED, not with a tolerance: measured span is 2.66540 and 2.92528,
    // so `toBeCloseTo(2.67, 2)` cleared its ±0.005 window by 0.0046 — 92% of the
    // tolerance spent, i.e. a one-bit change to the lightest or darkest colour
    // flips it red for no accessibility reason. That is the objection theme.ts
    // raises against shipping a colour that clears a floor by 0.04, applied to the
    // assertion instead of the palette. The rounded value is what the docstring
    // quotes anyway.
    const SPAN = { light: '2.67', dark: '2.93' } as const
    const lum = chartTheme(mode).SERIES
      .map((hex) => relativeLuminance(parseHex(hex)))
      .sort((a, b) => a - b)
    const span = (lum[lum.length - 1] + 0.05) / (lum[0] + 0.05)
    expect(span, `${mode} SERIES spans only ${span.toFixed(2)}:1 end to end`).toBeGreaterThan(1.5)
    expect.soft(span.toFixed(2), `${mode}: theme.ts quotes ${SPAN[mode]}:1 for this set`).toBe(SPAN[mode])
  })

  it('simulates each dichromacy rather than trusting the helper', () => {
    // A simulator that returned its input would make every assertion above
    // vacuous, and it would look green forever.
    //
    // ⚠️ ONE ANCHOR PER CONDITION, because one was not enough and that was
    // measured, not guessed. The previous version exercised 'deutan' only, and
    // with it in place BOTH other matrices could be replaced by the identity
    // matrix with the whole suite still passing — the protan and tritan columns
    // simply reported normal-vision distances, which are comfortably over the
    // floor. Two thirds of the guard this branch exists for was decorative.
    //
    // Each pair below is built ON that condition's confusion line: take a colour
    // into LMS, scale ONLY the cone the condition is missing, come back. So the
    // pair is invisible to exactly one dichromat and obvious to everyone else —
    // which is why each row asserts a collapse AND two survivals. A matrix
    // swapped for identity fails its own collapse (the pair scores 58-66 in
    // normal vision); two matrices swapped for each other fail it too.
    //
    // ⚠️ A lightness-matched red/green pair does NOT work for protan, which is
    // what the old comment's reasoning would have predicted: #C1554B/#4E8C4A
    // collapses for a deuteranope (ΔE00 2.65) and stays open for a protanope
    // (14.09), because protanopia also darkens reds. Same axis, different
    // luminous efficiency — the confusion line has to be built per condition.
    //
    // ⚠️ SURVIVAL IS 15, NOT THE 25 THIS ASSERTED IN CIE76. Re-measured under
    // ΔE00 the tightest survival is the deutan pair seen by a protanope, 20.94 —
    // it would have failed 25 for no reason but the change of metric, and quietly
    // "fixing" that by picking friendlier anchor colours would be tuning the
    // instrument to the reading. 15 sits above the floor these must clear by a
    // clear margin and below every measured survival by at least 5.9.
    const SURVIVES = 15
    const ANCHORS = [
      { kind: 'protan', a: '#2D6C51', b: '#FE2D4E', collapse: 0.78, normal: 62.9 },
      { kind: 'deutan', a: '#CA5259', b: '#209A50', collapse: 0.27, normal: 65.8 },
      { kind: 'tritan', a: '#6C7853', b: '#8E4AE8', collapse: 0.61, normal: 58.1 },
    ] as const
    expect(SURVIVES, 'a survival threshold under the floor would assert nothing')
      .toBeGreaterThan(SEPARATION)
    // ⚠️ `collapse` AND `normal` ARE ASSERTED, not just recorded. They sat in this
    // literal being read by nothing — re-measured by the commit that adopted ΔE00
    // and then destructured away, which is prose wearing the costume of data.
    // They are also the only IDENTITIES left on the chromatic path: every other
    // ΔE00 assertion outside the palette tables is an inequality, and the two
    // remaining equalities (`#000000`/`#FFFFFF`, `#101010`/`#383838`) are greys,
    // which drive dL/Sl alone and exercise none of G, T, Sc, Sh or Rt. That matters
    // more since the re-palette landed: `DEBT` used to carry 14 pinned chromatic
    // distances and is gone, so outside these six the chromatic half of CIEDE2000 is
    // pinned only by `WORST` and the two `MARGIN` values.
    for (const { kind, a, b, collapse, normal } of ANCHORS) {
      const under = (k: Dichromacy) => deltaE2000(simulate(a, k), simulate(b, k))
      expect(under(kind), `${a}/${b} sits on the ${kind} confusion line and must collapse`)
        .toBeLessThan(SEPARATION)
      expect(under(kind), `${a}/${b} collapse under ${kind}`).toBeCloseTo(collapse, 2)
      expect(deltaE2000(a, b), `${a}/${b} in normal vision`).toBeCloseTo(normal, 1)
      for (const other of DICHROMACIES.filter((k) => k !== kind)) {
        expect(
          under(other),
          `${a}/${b} is only invisible to ${kind}; ${other} must still see it`,
        ).toBeGreaterThan(SURVIVES)
      }
    }
    // …and none of them may be an identity function.
    for (const kind of DICHROMACIES) {
      expect(simulateDichromacy('#D22B2B', kind), `${kind} returned its input`).not.toBe('#D22B2B')
    }
    expect(simulateDichromacy('nonsense', 'deutan')).toBeNull()
    // A malformed hex must fail a ceiling as loudly as a floor. The metric
    // returned 0 here once — which passes `toBeLessThan(SEPARATION)` silently,
    // i.e. it would have made every collapse assertion above vacuous.
    expect(deltaE2000('nonsense', '#000000')).toBeNaN()
  })

  it('reports when a simulated colour left the gamut instead of clipping it away', () => {
    // simulateDichromacy clamps out-of-range output, so for a colour that clips,
    // the hex it returns is not what the model says — it is the nearest thing a
    // screen can show, and a ΔE measured from it is partly measuring the clamp.
    //
    // This used to record six clipped colours, all tritan, worst 0.773 — i.e. more
    // than the entire linear range outside the cube. That was the single-plane
    // Viénot model, which its own authors validated for protan and deutan only.
    // Under Brettel's two half-planes the table is EMPTY, which is the strongest
    // evidence in this file that the model change was real: no palette colour was
    // touched, and every tritan distance in the repo moved anyway.
    // ⚠️ EVERY MARK THIS FILE MEASURES A ΔE FOR, not just SERIES. The loop used to
    // sweep the six SERIES alone — 36 checks under a docstring claiming 33 colours
    // — while INK_FAINT is scored in six of the twenty-one pairs above and the ring
    // colours are measured through the same simulator by the WORST table. The
    // control exists to guarantee that no pinned ΔE is partly a measurement of the
    // clamp, so it has to cover the colours that are pinned. None of the added
    // ones clips today; that is the point of checking rather than assuming.
    const clipped: Record<string, number> = {}
    for (const mode of MODES) {
      const { SERIES, INK_FAINT, HEALTH_COLOR, SURFACE } = chartTheme(mode)
      const marks: Array<[string, string]> = [
        ...SERIES.map((hex, i) => [`SERIES[${i}]`, hex] as [string, string]),
        ['INK_FAINT', INK_FAINT],
        ...RINGED.map(
          (s) => [`ring:${s}`, composite(HEALTH_COLOR[s], SURFACE, RING_OPACITY)] as [string, string],
        ),
      ]
      for (const [label, hex] of marks) {
        for (const kind of DICHROMACIES) {
          const err = dichromacyGamutError(hex, kind)
          if (err > 0) clipped[`${mode} ${label} ${kind}`] = Math.round(err * 1000) / 1000
        }
      }
    }
    expect(clipped, 'a chart colour now leaves the gamut under simulation').toEqual({})

    // ⚠️ THE ASSERTION ABOVE CANNOT FAIL ON ITS OWN, which is the failure mode this
    // repo keeps meeting: stub `dichromacyGamutError` to `return 0` and an empty
    // table stays empty. "Nothing clips" is a claim about THIS PALETTE, so it is
    // only worth anything next to a colour that does clip. A quarter of the sRGB
    // cube still does (measured on a 16³ grid, 3060 of 12288 colour-condition
    // pairs); these two are the extremes of it, and they are not palette colours,
    // so re-picking the six SERIES can never quietly disarm this control.
    const STILL_CLIPS: Array<[string, Dichromacy, number]> = [
      ['#FFFF00', 'protan', 0.345],
      ['#FFFF00', 'deutan', 0.255],
      ['#FFFF00', 'tritan', 0.148],
      ['#00FFFF', 'tritan', 0.376],
    ]
    for (const [hex, kind, err] of STILL_CLIPS) {
      expect(dichromacyGamutError(hex, kind), `${hex} under ${kind} must still clip`)
        .toBeCloseTo(err, 2)
    }
    // …and the same function must read zero for something that genuinely fits,
    // or "clips" would just mean "returns a positive number for everything".
    expect(dichromacyGamutError('#808080', 'tritan'), 'a grey cannot leave the gamut').toBe(0)
    expect(dichromacyGamutError('nonsense', 'tritan')).toBeNaN()
  })

  it('measures distance perceptually rather than in raw sRGB', () => {
    // The companion to the anchor above, and it exists because MUTATION FOUND THE
    // HOLE: replacing the metric's CIELAB conversion with a plain sRGB Euclidean
    // distance broke NOTHING — 38 tests stayed green. The simulator was pinned;
    // the metric it feeds was not.
    //
    // That gap is not academic. Scored with the naive metric against the same
    // SEPARATION constant, the light palette this branch REPLACED measures 14.6
    // and sails through, when its true worst pair is 5.2 — the exact defect this
    // work exists to fix, waved past by a one-line change no reviewer would
    // linger on. (Dark still fails at 4.0, so the swap hides half of it, which is
    // worse than hiding all of it: the suite stays red for the wrong reason and
    // gets "fixed" by touching only the dark set.)
    //
    // ⚠️ BOTH ANCHORS CAME FROM THE DELETED CIE76 FUNCTION AND STILL HOLD, which
    // is why deleting it cost nothing: they were never about the Euclidean part,
    // they are about `toLab`, which both metrics share. Two anchors, both from
    // CIELAB's definition rather than from our palette: black to white is exactly
    // ΔL* 100 and therefore ΔE00 100 as well (its lightness weight Sl is 1 at the
    // midpoint), where sRGB distance reads 441.7…
    expect(deltaE2000('#000000', '#FFFFFF')).toBeCloseTo(100, 3)
    // …and equal steps must NOT read as equal differences at both ends of the
    // scale. These two pairs are the same sRGB distance apart (69.3 exactly), and
    // a perceptual metric has to rank the dark one further apart, because the eye
    // does. Any metric linear in sRGB scores them identically and fails here.
    // ΔE00 separates them slightly harder than CIE76 did, 1.35× against 1.33×.
    const dark = deltaE2000('#101010', '#383838')
    const light = deltaE2000('#C8C8C8', '#F0F0F0')
    expect(dark / light, `dark ${dark.toFixed(1)} vs light ${light.toFixed(1)}`).toBeGreaterThan(1.2)
  })

  it.each(MODES)('SERIES[0] is the accent token in %s mode', (mode) => {
    // theme.ts has always claimed "[0] is the --accent token exactly". It was
    // true of light and false of dark, which shipped #0E9F6E against an --accent
    // of #10B981 — the last of the chart/app colour divergences, and the only
    // one no test spoke for. Now the sentence is enforced rather than asserted
    // in prose.
    const t = chartTheme(mode)
    expect(t.SERIES[0]).toBe(t.ACCENT)
  })

  it.each(MODES)('ACCENT and DANGER are the app tokens in %s mode', (mode) => {
    // The divergence theme.ts used to document as unresolved: a chart drew its
    // bar in one red while the label describing it rendered another. Splitting
    // the palette by mode is what made closing it possible, and this is what
    // keeps it closed — the two now have to move together or fail here.
    const t = tokens(mode)
    expect(chartTheme(mode).ACCENT.toLowerCase()).toBe(t['--accent'])
    expect(chartTheme(mode).DANGER.toLowerCase()).toBe(t['--danger'])
    // ⚠️ SURFACE belongs in this pin more than either of them. It is the BACKDROP
    // every trust-ring ratio in this file and in `ForceGraph.test` is composited
    // and scored against, and it was the one unpinned copy: warm `--surface` up
    // to an off-white in index.css and every one of those ratios would keep
    // scoring against a stale #FFFFFF and stay green while the real composite
    // fell. Quoting the backdrop is this file's own rule, applied to itself.
    expect(chartTheme(mode).SURFACE.toLowerCase()).toBe(t['--surface'])
  })

  it('keeps AXIS below the text threshold it was moved off', () => {
    // The other half of the split. Without this, someone could darken AXIS to
    // 5:1, leave every label on INK_SOFT, and the two tokens would silently
    // become interchangeable — at which point the whole distinction is dead
    // code and the next person reintroduces `fill={AXIS}` reasonably.
    for (const mode of MODES) {
      const { AXIS } = chartTheme(mode)
      const worst = Math.min(...backgrounds(mode).map(([, bg]) => contrastRatio(AXIS, bg)))
      expect(worst, `AXIS in ${mode} now clears AA — collapse the two tokens or re-scope`).toBeLessThan(TEXT)
    }
  })
})
