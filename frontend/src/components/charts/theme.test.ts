import { describe, expect, it } from 'vitest'
import { chartTheme, GLYPH, GRAPH_TYPES, RING_OPACITY, SERIES_COUNT } from './theme'
import { contrastRatio, deltaE, hexToRgb, simulateDichromacy } from '../../lib/color'
import type { GraphHealthStatus } from '../../types'
// `?raw` resolves to the file only because vite.config.ts sets `test.css: true`
// — with vitest's default the import silently yields an empty string, and every
// ratio below would score against a token table that parsed to nothing. The
// "reads the surfaces out of index.css" test is what makes that loud.
import indexCss from '../../index.css?raw'
import forceGraphSrc from '../graph/ForceGraph.tsx?raw'

/** WCAG's non-text floor. Bars, slices, rules, rings, node fills. */
const GRAPHIC = 3
/** WCAG AA for text. */
const TEXT = 4.5
/**
 * Perceptual distance two series must keep, in normal vision and under each
 * dichromacy. CIE76 ΔE: ~2.3 is the just-noticeable difference under ideal
 * conditions, so 10 is roughly four of those — the margin a thin line or a small
 * slice needs to stay legible against a busy chart rather than in a lab.
 *
 * ⚠️ WHICH PALETTES THIS IS POINTED AT, AND WHY NOT THE OTHERS. Only SERIES is
 * scored. That is deliberate: SERIES is the one palette where colour is the ONLY
 * thing telling two marks apart — the line widgets give every series the same
 * width and no dash, and pie slices carry no on-arc label.
 *
 * GRAPH_TYPE_COLORS and HEALTH_COLOR are not scored, and extending this loop to
 * them would report failures that are not defects. Both would fail (14 of 36
 * light node pairs collide under some dichromacy, worst ΔE 1.0), but node type
 * is carried by a per-type icon plus the type's name in words at every site that
 * is not `aria-hidden`. See the note above GRAPH_LIGHT in theme.ts for the
 * measurement and the reasoning.
 *
 * The one genuine gap this does not cover is trust-ring SEVERITY, where warn vs
 * danger is hue alone on the canvas — its own ticket, deliberately not widened
 * into here.
 */
const SEPARATION = 10
const DICHROMACIES = ['protan', 'deutan', 'tritan'] as const

/**
 * `fg` at `alpha` over `bg`, as the browser composites it.
 *
 * Scoring the raw hex would be scoring a colour the product never paints — the
 * lesson the axis rules taught, where `stroke={AXIS} opacity={0.6}` composited
 * to 1.90 while a test on the token itself read 3.24 and stayed green.
 *
 * `RING_OPACITY` is imported from the theme rather than mirrored here. It used
 * to be a local literal kept honest by grepping ForceGraph for it, which is a
 * weaker joint than it looks: the grep asserts that SOMETHING in that file has
 * the shape, not that the ring does.
 */
function composite(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg)
  const b = hexToRgb(bg)
  if (!f || !b) throw new Error(`composite() got a malformed hex: ${fg} over ${bg}`)
  const mix = f.map((c, i) => Math.round(alpha * c + (1 - alpha) * b[i]))
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`
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
    expect(forceGraphSrc.length, 'ForceGraph source did not resolve').toBeGreaterThan(1000)
    expect(forceGraphSrc).toContain('opacity={dimmed ? 0.4 : RING_OPACITY}')
    expect(forceGraphSrc, 'RING_OPACITY must come from the theme, not a local').toMatch(
      /import \{[^}]*\bRING_OPACITY\b[^}]*\} from '\.\.\/charts\/theme'/,
    )
  })

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
    // #9776B3 sit 0.4 L* apart and still score ΔE 43.1 under deuteranopia. A
    // deuteranope has plenty to go on — deuteranopia deletes red-green and
    // leaves blue-yellow standing, and green-vs-violet rides that surviving axis.
    //
    // So the two properties are INDEPENDENT, not nested. Every dichromacy model
    // preserves lightness, which means no assertion in this test can ever see a
    // greyscale collision; scored separately, this palette has 4 light pairs and
    // 8 dark under the same floor in greyscale, worst 0.4. Neither did the check
    // this replaced actually cover that — its light set measured 8 such pairs
    // while passing. Greyscale is an open ticket, not a thing proven below.
    const { SERIES } = chartTheme(mode)
    expect(SERIES).toHaveLength(SERIES_COUNT)
    for (let i = 0; i < SERIES.length; i++) {
      for (let j = i + 1; j < SERIES.length; j++) {
        expect(
          deltaE(SERIES[i], SERIES[j]),
          `SERIES[${i}] ${SERIES[i]} vs SERIES[${j}] ${SERIES[j]} in normal vision (${mode})`,
        ).toBeGreaterThanOrEqual(SEPARATION)
        for (const kind of DICHROMACIES) {
          const a = simulateDichromacy(SERIES[i], kind)
          const b = simulateDichromacy(SERIES[j], kind)
          expect(a && b, `${SERIES[i]}/${SERIES[j]} failed to simulate`).toBeTruthy()
          expect(
            deltaE(a as string, b as string),
            `SERIES[${i}] ${SERIES[i]} vs SERIES[${j}] ${SERIES[j]} under ${kind} (${mode})`,
          ).toBeGreaterThanOrEqual(SEPARATION)
        }
      }
    }
  })

  it('simulates dichromacy rather than trusting the helper', () => {
    // A simulator that returned its input would make every assertion above
    // vacuous, and it would look green forever. Two anchors from the model's own
    // definition: the red/green axis must COLLAPSE for a deuteranope, and the
    // blue/yellow axis it leaves intact must NOT.
    //
    // ⚠️ The red/green pair is matched for lightness on purpose. The first
    // version of this anchor used #D22B2B vs #2BA84A and FAILED at ΔE 16.5 —
    // correctly, because those two differ by 14 L*, and deuteranopia does not
    // touch lightness. Picking a "obviously red vs obviously green" pair tests
    // nothing if the two also differ in a channel the condition leaves alone.
    const collapsed = deltaE(
      simulateDichromacy('#C1554B', 'deutan') as string,
      simulateDichromacy('#4E8C4A', 'deutan') as string,
    )
    const survives = deltaE(
      simulateDichromacy('#1F6FEB', 'deutan') as string,
      simulateDichromacy('#E3B341', 'deutan') as string,
    )
    expect(collapsed, 'red vs green should collapse under deuteranopia').toBeLessThan(SEPARATION)
    expect(survives, 'blue vs yellow should survive deuteranopia').toBeGreaterThan(30)
    // …and it must not be an identity function.
    expect(simulateDichromacy('#D22B2B', 'deutan')).not.toBe('#D22B2B')
    expect(simulateDichromacy('nonsense', 'deutan')).toBeNull()
  })

  it('measures distance perceptually rather than in raw sRGB', () => {
    // The companion to the anchor above, and it exists because MUTATION FOUND THE
    // HOLE: replacing deltaE's CIELAB conversion with a plain sRGB Euclidean
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
    // Two anchors, both from CIELAB's definition rather than from our palette:
    // black to white is exactly ΔL* 100 and therefore ΔE 100, where sRGB distance
    // reads 441.7…
    expect(deltaE('#000000', '#FFFFFF')).toBeCloseTo(100, 3)
    // …and equal steps must NOT read as equal differences at both ends of the
    // scale. These two pairs are the same sRGB distance apart (69.3 exactly), and
    // a perceptual metric has to rank the dark one further apart, because the eye
    // does. Any metric linear in sRGB scores them identically and fails here.
    const dark = deltaE('#101010', '#383838')
    const light = deltaE('#C8C8C8', '#F0F0F0')
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
