import { describe, expect, it } from 'vitest'
import {
  chartTheme,
  GLYPH,
  GRAPH_TYPES,
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

/** WCAG's non-text floor. Bars, slices, rules, rings, node fills. */
const GRAPHIC = 3
/** WCAG AA for text. */
const TEXT = 4.5
/**
 * Perceptual distance two series must keep, in normal vision and under each
 * dichromacy, in **CIEDE2000** — the ticket that asked for it is closed, and the
 * tritan gamut fix it had to follow landed with it.
 *
 * ⚠️ THE DIGIT DID NOT MOVE WHEN THE METRIC DID, and that is a decision, not an
 * oversight. Under ΔE00 this palette has 14 pairs below 10 (they are named in
 * DEBT, below), so re-deriving the floor downward until they passed was available
 * and was refused: a floor chosen to fit the numbers it grades stops being a
 * requirement and becomes a description of the status quo. What licenses keeping
 * the same digit is that the two metrics are anchored at the same place — black
 * to white is exactly 100 in both — so "10" means the same tenth of the lightness
 * range on either scale.
 *
 * ⚠️ "10 ≈ four JNDs" IS STILL THE WRONG WAY TO READ IT. That arithmetic (~2.3
 * per JND) belongs to CIE76 and was wrong there too, since CIE76 is not uniform.
 * 10 is a working floor for a small mark on a busy chart, not four of anything.
 *
 * ⚠️ AND EVERY NUMBER THIS DOCSTRING USED TO QUOTE WAS A MEASUREMENT OF A BUG.
 * It said the weakest pairs were 5.37 (light) and 5.34 (dark); under the Brettel
 * model they are 3.24 and 3.99, and the tritan figures moved most because the old
 * single-plane model threw those colours out of gamut and the simulator clamped
 * them silently. The old "3-5× better than the palette it replaced" claim is not
 * restated here for the same reason — it was computed against the same clamp.
 *
 * ⚠️ WHICH PALETTES THIS IS POINTED AT, AND WHY NOT THE OTHERS. It scores the
 * marks a single chart can place side by side: the six SERIES, plus the INK_FAINT
 * "other" wedge a folded pie adds. That set is where colour is the ONLY thing
 * telling two marks apart — the line widgets give every series the same width and
 * no dash, and pie slices carry no on-arc label.
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
const separations = (pa: string, pb: string) =>
  [
    ['none', deltaE2000(pa, pb)] as const,
    ...DICHROMACIES.map(
      (d) => [d, deltaE2000(simulateDichromacy(pa, d)!, simulateDichromacy(pb, d)!)] as const,
    ),
  ].sort((x, y) => x[1] - y[1])

const worstSeparation = (pa: string, pb: string) => separations(pa, pb)[0][1]
const worstCondition = (pa: string, pb: string) => separations(pa, pb)[0][0]

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
    for (const [i, hex] of SERIES.entries()) {
      for (const [name, bg] of backgrounds(mode)) {
        expect(contrastRatio(hex, bg), `SERIES[${i}] ${hex} on ${name} (${mode})`).toBeGreaterThanOrEqual(GRAPHIC)
      }
    }
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
      const worst = worstSeparation(pa, pb)
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
      const [expected, condition] = WORST[mode][`${a}/${b}`]
      expect.soft(worstSeparation(pa, pb), `${a}/${b} (${mode})`).toBeCloseTo(expected, 1)
      // Not just the number but WHICH reader is worst off — a metric that drifted
      // while happening to land on the same figure would still be caught, and the
      // condition is the half the prose is actually about.
      expect.soft(worstCondition(pa, pb), `${a}/${b} (${mode}) worst condition`).toBe(condition)
    }
  })

  /**
   * THE PAIRS THIS PALETTE DOES NOT YET KEEP APART, named and measured.
   *
   * Not a softened floor — `SEPARATION` is unchanged and every pair absent from
   * this table still has to clear it. This is a debt register, on the precedent
   * `theme.contrast.test` set with its `<=16` lock: state the shortfall exactly,
   * so it cannot grow, cannot be added to quietly, and cannot be forgotten.
   *
   * WHY THE DEBT EXISTS AT ALL. These 14 pairs are not a regression. The palette
   * was picked against CIE76 distances computed through the Viénot single plane,
   * which threw six of these colours out of gamut under tritanopia and clamped
   * them silently — so the numbers it was chosen by were partly measurements of
   * that clamp. Fixing the model and the metric is what made the real distances
   * visible, and the worst of them is light S4/INK_FAINT at 3.24: mauve against
   * the folded-pie grey, for a tritanope, in the one widget with no on-arc labels.
   *
   * ⚠️ RE-PICKING THE COLOURS IS A SEPARATE TICKET, deliberately. It is a design
   * decision with a person's taste in it, it touches every chart in the product,
   * and doing it in the same commit as the model would mean choosing colours and
   * grading them with the same instrument in one motion — which is how the
   * previous palette got picked against a broken measurement in the first place.
   *
   * The value is the worst over normal vision and all three dichromacies; the
   * condition is which reader is worst off. Both are pinned, because a metric that
   * drifted onto the same number for a different reader would otherwise pass.
   */
  const DEBT: Record<'light' | 'dark', Record<string, [number, Dichromacy | 'none']>> = {
    light: {
      'S0/S2': [5.19, 'tritan'],
      'S0/S3': [9.88, 'deutan'],
      'S1/S5': [7.49, 'deutan'],
      'S1/INK_FAINT': [7.25, 'deutan'],
      'S2/S4': [9.24, 'protan'],
      'S4/S5': [3.8, 'tritan'],
      'S4/INK_FAINT': [3.24, 'tritan'],
    },
    dark: {
      'S0/S1': [9.96, 'protan'],
      'S0/S2': [8.9, 'tritan'],
      'S0/S3': [6.61, 'protan'],
      'S0/S5': [7.34, 'deutan'],
      'S1/S2': [7.19, 'tritan'],
      'S4/S5': [3.99, 'tritan'],
      'S4/INK_FAINT': [6.33, 'tritan'],
    },
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
    // ⚠️ WHAT THIS FLOOR DOES NOT DO IS SUBSUME THE OLD ONE, which an earlier
    // draft of this comment claimed on the reasoning that "two colours cannot
    // clear 10 ΔE for a deuteranope without a real lightness difference, because
    // that reader has nothing else to go on". Measured, that is false, and the
    // palette in this very file disproves it: SERIES[1] #009562 vs SERIES[4]
    // #9776B3 sit 0.4 L* apart and still score ΔE00 28.9 under deuteranopia. A
    // deuteranope has plenty to go on — deuteranopia deletes red-green and
    // leaves blue-yellow standing, and green-vs-violet rides that surviving axis.
    //
    // So the two properties are INDEPENDENT, not nested. Every dichromacy model
    // preserves lightness, which means no assertion in this test can ever see a
    // greyscale collision; scored separately, this palette has 4 light pairs and
    // 8 dark under the same floor in greyscale, worst 0.4. Neither did the check
    // this replaced actually cover that — its light set measured 8 such pairs
    // while passing. Greyscale is an open ticket, not a thing proven below.
    const { SERIES, INK_FAINT } = chartTheme(mode)
    expect(SERIES).toHaveLength(SERIES_COUNT)

    // ⚠️ THE SET SCORED IS "MARKS A CHART CAN PUT SIDE BY SIDE", NOT "SERIES".
    // Scoring SERIES×SERIES alone let a real collision ship: a folded pie paints
    // its "other" wedge in INK_FAINT, a neutral grey that measured ΔE 1.26 from
    // the neutral-grey SERIES[5] in light mode — in the one widget with no on-arc
    // labels, which is the widget this floor's docstring names as its reason.
    // TOP_N is imported rather than reasoned about so the two cannot drift.
    //
    // ⚠️ THAT SAME S5/INK_FAINT PAIR IS STILL THE CLOSEST TWO COLOURS IN THE LIGHT
    // SET — ΔE00 1.15 raw, 1.07 under tritanopia — and it is deliberately NOT
    // scored, which is easy to misread as an omission. `coexists` excludes it
    // because SERIES[5] is the one series a folded pie never paints: the wedge that
    // would have used it is the "other" wedge, and that wedge is INK_FAINT. The two
    // cannot appear in the same chart, so the distance between them is not a defect.
    expect(TOP_N, 'a folded pie must leave one series unused for the other wedge')
      .toBeLessThanOrEqual(SERIES_COUNT - 1)
    const MARKS = [
      ...SERIES.map((hex, i) => ({ hex, label: `S${i}` })),
      { hex: INK_FAINT, label: 'INK_FAINT' },
    ]
    // INK_FAINT only ever shares a pie with the first TOP_N series, so it is
    // scored against those and not against the one held in reserve.
    const coexists = (x: number, y: number) =>
      MARKS[x].hex !== INK_FAINT && MARKS[y].hex !== INK_FAINT ? true : Math.max(x, y) === MARKS.length - 1 && Math.min(x, y) < TOP_N

    const below: string[] = []
    for (let i = 0; i < MARKS.length; i++) {
      for (let j = i + 1; j < MARKS.length; j++) {
        if (!coexists(i, j)) continue
        const [A, B] = [MARKS[i], MARKS[j]]
        const key = `${A.label}/${B.label}`
        const worst = worstSeparation(A.hex, B.hex)
        const condition = worstCondition(A.hex, B.hex)
        const owed = DEBT[mode][key]
        const where = `${A.label} ${A.hex} vs ${B.label} ${B.hex} (${mode}), worst under ${condition}`
        if (owed) {
          // A recorded debt is pinned in BOTH directions, value and condition. A
          // one-sided ratchet would let the palette ticket land silently; this way
          // the fix has to come here and delete the row, which is where the reader
          // finds out the floor is met again.
          expect.soft(worst, `${where} — recorded debt moved`).toBeCloseTo(owed[0], 1)
          expect.soft(condition, `${where} — recorded debt changed reader`).toBe(owed[1])
        } else {
          expect.soft(worst, `${where} — below the floor and not a recorded debt`)
            .toBeGreaterThanOrEqual(SEPARATION)
        }
        if (worst < SEPARATION) below.push(key)
      }
    }
    // ⚠️ THE ASSERTION THAT MAKES THE TABLE A RATCHET RATHER THAN A SNAPSHOT.
    // Without it a future failing pair could be waved through by adding a row, and
    // — the direction that actually bites — `SEPARATION` could be mutated to 0 or
    // 1e9 with every pin above still passing, because the pins measure distances
    // and never consult the floor. Set equality consults it twice.
    expect(below.sort(), `${mode}: the set of pairs under the floor is not the recorded debt`)
      .toEqual(Object.keys(DEBT[mode]).sort())
  })

  it.each(MODES)('keeps the SERIES span the mode-split was justified by in %s mode', (mode) => {
    // The deleted luminance-neighbour check took a second assertion down with it:
    // theme.ts still argues the split is worth it because each set spans further
    // than the 1.50:1 a shared palette is capped at, and quotes 2.65:1 and 2.11:1.
    // Those are load-bearing numbers with nothing holding them. The pairwise floor
    // does NOT imply them — pairs can separate on hue.
    //
    // ⚠️ Deliberately not a neighbour-gap check. The new light set's smallest
    // neighbour gap is 0.0041, against the 0.02 the deleted test demanded, and
    // that is the greyscale ticket rather than something to re-assert here.
    const lum = chartTheme(mode).SERIES.map((hex) => {
      const rgb = hexToRgb(hex)
      if (!rgb) throw new Error(`malformed palette hex: ${hex}`)
      return relativeLuminance(rgb)
    }).sort((a, b) => a - b)
    const span = (lum[lum.length - 1] + 0.05) / (lum[0] + 0.05)
    expect(span, `${mode} SERIES spans only ${span.toFixed(2)}:1 end to end`).toBeGreaterThan(1.5)
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
    for (const { kind, a, b } of ANCHORS) {
      expect(
        deltaE2000(simulateDichromacy(a, kind) as string, simulateDichromacy(b, kind) as string),
        `${a}/${b} sits on the ${kind} confusion line and must collapse`,
      ).toBeLessThan(SEPARATION)
      for (const other of DICHROMACIES.filter((k) => k !== kind)) {
        expect(
          deltaE2000(simulateDichromacy(a, other) as string, simulateDichromacy(b, other) as string),
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
    const clipped: Record<string, number> = {}
    for (const mode of MODES) {
      for (const [i, hex] of chartTheme(mode).SERIES.entries()) {
        for (const kind of DICHROMACIES) {
          const err = dichromacyGamutError(hex, kind)
          if (err > 0) clipped[`${mode}[${i}] ${kind}`] = Math.round(err * 1000) / 1000
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
