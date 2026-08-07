/**
 * A ratchet on the one rule that keeps `theme.ts` honest.
 *
 * The palette in `theme.ts` is stored as hex on purpose: SVG `stroke=`/`fill=`
 * and the chart libraries do not resolve CSS custom properties, so the graphics
 * cannot use the app's `--accent` / `--danger` tokens. The app's own tokens were
 * darkened for WCAG AA (PR #29); the chart hexes were not, and must not be —
 * they are graphics, judged against 3:1, not 4.5:1.
 *
 * The bug that follows from that split is using a chart hex as TEXT. Measured in
 * light mode against `--surface` / `--surface-2`:
 *
 *   DANGER    #D87C6B   2.72 – 2.99   (also fails the 3:1 graphics floor)
 *   ACCENT    #0E9F6E   3.07 – 3.39
 *   SERIES[n] various   1.89 – 3.24
 *   AXIS      #8C877E   3.24 – 3.57
 *
 * Every site that had this was small text (`text-xs` / `text-sm` / SVG
 * `fontSize` 9–12), so the large-text 3:1 exemption never applied. In dark mode
 * DANGER and ACCENT ARE the token values (`--danger` = 216 124 107 = #D87C6B,
 * `--accent` = 16 185 129 = #10B981), which is why moving text onto the tokens
 * changed light mode only.
 *
 * The rule: hex for `stroke` / `fill` / `background`, tokens (or `INK_SOFT`) for
 * anything a person reads.
 *
 * TWO SHAPES ARE CHECKED, because the first version of this file checked one and
 * a review found live violations of the other in a file the same commit edited:
 *
 *   1. CSS   — a `style=` prop whose `color:` resolves to a palette constant.
 *              Anchored on `style=` and not on bare `color:`, because `color` is
 *              also an ordinary key in this codebase's palette lookup tables
 *              (`{ key: 'weaknesses', color: DANGER }`), where the value goes on
 *              to a `background` and is correct.
 *   2. SVG   — `<text fill={...}>`. This is the spelling MonteCarloPanel's
 *              markers used, so a rule that only understood `color:` was blind
 *              to the exact defect it had just been written for.
 *
 * KNOWN LIMITS, stated rather than papered over:
 *   - Indirection is invisible. `style={{ color: meta.color }}` fed from a
 *     lookup table reads as clean here; PorterForces and MonteCarloPanel were
 *     both that shape and had to be found by reading. Those two are pinned by
 *     their own component tests instead.
 *   - The CSS scan is per-line, so a prettier-wrapped multi-line style object
 *     would slip through.
 *   - AXIS on SVG text is deliberately EXEMPT and separately capped below.
 */
import { describe, expect, it } from 'vitest'

// Vite's own raw-import glob rather than node:fs. The frontend has no
// @types/node — `tsc -b` rejects `import { readFileSync } from 'node:fs'` with
// TS2307 — and a scan helper is not worth pulling a new devDependency in for.
const SOURCES: Record<string, string> = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Palette exports that must never end up as text. */
const PALETTE = String.raw`DANGER|ACCENT|SERIES|HEALTH_COLOR|GRAPH_TYPE_COLORS|AXIS`

/**
 * `style=` … `color:` … palette constant, with anything in between.
 *
 * The `[^]*?` after `color:` is what makes the ternary form visible:
 * `style={{ color: delta >= 0 ? undefined : DANGER }}` shipped past the earlier
 * `color:\s*(DANGER|ACCENT)` version, which required the constant to sit
 * immediately after the colon.
 */
const CSS_USE = new RegExp(String.raw`style=[^]*?\bcolor:[^;}]*?\b(?:theme\.)?(?:${PALETTE})\b`)

/**
 * SVG text `fill=`. AXIS is excluded here on purpose — see AXIS_TEXT_CAP.
 */
const SVG_TEXT_FILL = new RegExp(
  String.raw`fill=\{[^}]*\b(?:theme\.)?(?:DANGER|ACCENT|SERIES|HEALTH_COLOR|GRAPH_TYPE_COLORS)\b`,
)
const SVG_TEXT_AXIS = /fill=\{[^}]*\b(?:theme\.)?AXIS\b/

/** Only files that pull the constants out of `charts/theme` are in scope.
 *  `ui/form.tsx` declares its own `const DANGER = 'rgb(var(--danger))'`, which is
 *  already a token and must not be reported. */
const IMPORTS_THEME = /from\s+'[^']*charts\/theme'/

/**
 * Every `<text …>` opening tag, sliced exactly.
 *
 * Brace-aware rather than `/<text[^>]*>/`: JSX attribute values legitimately
 * contain `>` (`fill={delta > 0 ? a : b}`), and a naive scan would cut the tag
 * in half and miss the fill.
 */
function textTags(src: string): string[] {
  const tags: string[] = []
  for (let i = src.indexOf('<text'); i !== -1; i = src.indexOf('<text', i + 5)) {
    let depth = 0
    for (let j = i; j < src.length; j++) {
      const c = src[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) {
        tags.push(src.slice(i, j + 1))
        break
      }
    }
  }
  return tags
}

const scannable = () =>
  Object.entries(SOURCES).filter(([f, src]) => !/\.test\.tsx?$/.test(f) && IMPORTS_THEME.test(src))

describe('chart palette constants are never used as text color', () => {
  it('resolved the source glob at all', () => {
    // The failure mode of every source-scanning test is a glob that quietly
    // matches nothing, leaving each assertion below vacuously green. Pinned on
    // the glob — the mechanism that can break — rather than on the number of
    // files importing the palette, which legitimately shrinks as sites migrate.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(200)
    expect(scannable().length).toBeGreaterThan(0)
  })

  it('has no palette constant behind a `style` color', () => {
    const offenders: string[] = []
    for (const [file, src] of scannable()) {
      src.split('\n').forEach((line, i) => {
        if (CSS_USE.test(line)) offenders.push(`${file}:${i + 1}`)
      })
    }
    expect(
      offenders,
      'Use rgb(var(--danger)) / rgb(var(--accent)) — or the text-danger / ' +
        'text-accent classes — for text. The hex constants are for stroke, fill ' +
        'and background only; as text they measure 1.89–3.57:1 in light mode.',
    ).toEqual([])
  })

  it('has no palette constant filling SVG text', () => {
    const offenders: string[] = []
    for (const [file, src] of scannable()) {
      for (const tag of textTags(src)) {
        if (SVG_TEXT_FILL.test(tag)) offenders.push(`${file}: ${tag.slice(0, 60)}…`)
      }
    }
    expect(
      offenders,
      'SVG text takes theme.INK_SOFT (or theme.INK). Keep the palette color on ' +
        'the rule, bar or node the label sits next to — see MonteCarloPanel.',
    ).toEqual([])
  })

  it('does not grow the axis-label debt', () => {
    // `theme.AXIS` renders the tick labels of every chart and measures 3.24–3.57
    // in light and 3.31–4.02 in dark — a real AA failure in both modes, but one
    // whose fix repaints every chart in the product and is therefore a design
    // decision, tracked separately. Capped rather than banned: the count may
    // fall as that ticket lands, and must not rise in the meantime.
    const sites = scannable().flatMap(([file, src]) =>
      textTags(src).filter((t) => SVG_TEXT_AXIS.test(t)).map(() => file),
    )
    expect(
      sites.length,
      `Axis-colored SVG text grew to ${sites.length}. Use theme.INK_SOFT for new ` +
        'chart labels; the existing ones are a tracked, separately-ticketed debt.',
    ).toBeLessThanOrEqual(16)
  })

  it('still finds the violation when one is introduced', () => {
    // Pins the matchers themselves: a ratchet that cannot fail is decoration.
    // Every positive below is a spelling that actually stood in this repo.
    expect(CSS_USE.test('style={{ color: DANGER }}')).toBe(true)
    expect(CSS_USE.test('style={up ? undefined : { color: DANGER }}')).toBe(true)
    expect(CSS_USE.test('style={d >= 0 ? { color: theme.ACCENT } : { color: DANGER }}')).toBe(true)
    // The ternary-inside-the-value form the first version of this rule missed.
    expect(CSS_USE.test('style={{ color: delta >= 0 ? undefined : DANGER }}')).toBe(true)
    expect(CSS_USE.test('style={count === 0 ? { color: AXIS } : undefined}')).toBe(true)

    // ...and these must NOT match, or the rule would ban the palette itself.
    expect(CSS_USE.test('fill={DANGER}')).toBe(false)
    expect(CSS_USE.test('stroke={theme.ACCENT}')).toBe(false)
    expect(CSS_USE.test('style={{ background: DANGER }}')).toBe(false)
    // The palette-map form — a `color` field feeding a background/stroke later.
    expect(CSS_USE.test("  { key: 'weaknesses', color: DANGER },")).toBe(false)
    expect(CSS_USE.test("  { v: result.p50, label: 'P50', color: theme.ACCENT },")).toBe(false)
    // The correct replacements.
    expect(CSS_USE.test("style={{ color: 'rgb(var(--danger))' }}")).toBe(false)

    // SVG side.
    expect(SVG_TEXT_FILL.test('<text fontSize={10} fill={theme.ACCENT}>')).toBe(true)
    expect(SVG_TEXT_FILL.test('<text fill={GRAPH_TYPE_COLORS[n.type] ?? theme.ACCENT}>')).toBe(true)
    expect(SVG_TEXT_FILL.test('<text fill={theme.INK_SOFT}>')).toBe(false)
    expect(SVG_TEXT_FILL.test('<text fill="currentColor">')).toBe(false)
    // AXIS is the capped exemption, not part of the ban.
    expect(SVG_TEXT_FILL.test('<text fill={theme.AXIS}>')).toBe(false)
    expect(SVG_TEXT_AXIS.test('<text fill={theme.AXIS}>')).toBe(true)
  })

  it('slices a <text> tag whose attributes contain a `>`', () => {
    // The reason textTags is brace-aware. A naive /<text[^>]*>/ stops at the `>`
    // inside the ternary and never sees the fill.
    const tags = textTags('<text x={1} fill={d > 0 ? theme.ACCENT : theme.INK_SOFT}>hi</text>')
    expect(tags.length).toBe(1)
    expect(SVG_TEXT_FILL.test(tags[0])).toBe(true)
  })
})
