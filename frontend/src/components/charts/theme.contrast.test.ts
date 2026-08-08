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
 * AXIS USED TO BE A CAPPED EXEMPTION HERE. It is now banned like the rest, and
 * the cap is gone — but the cap deserves an obituary, because it was wrong in a
 * way that looked right:
 *
 *   It counted `<text fill={theme.AXIS}>` and nothing else, and reported 16.
 *   The real number was larger, because recharts defaults tick TEXT to the axis
 *   `stroke`:
 *
 *     // CartesianAxis.renderTicks
 *     var tickProps = { ...axisProps, stroke: 'none', fill: stroke, ...customTickProps }
 *
 *   So `<XAxis stroke={AXIS} />` painted every tick label at 3.24–4.02 without
 *   the string `fill` appearing anywhere near it. A ratchet that only knows one
 *   spelling of a defect reports the debt it can see, not the debt there is.
 *
 * Hence the two rules below: `fill` is banned in EVERY spelling, and an axis
 * that carries `stroke={AXIS}` must also carry an explicit `tick`, because
 * without one recharts silently supplies the banned color for it.
 *
 * KNOWN LIMITS, stated rather than papered over:
 *   - Indirection is invisible. `style={{ color: meta.color }}` fed from a
 *     lookup table reads as clean here; PorterForces and MonteCarloPanel were
 *     both that shape and had to be found by reading. Those two are pinned by
 *     their own component tests instead.
 *   - The CSS scan is per-line, so a prettier-wrapped multi-line style object
 *     would slip through.
 *   - The shared builders in `axis.tsx` return prop OBJECTS, not JSX, so the
 *     structural rule cannot see them. `axis.test.tsx` asserts their return
 *     values directly instead — a stronger check than any regex here.
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

/** SVG text `fill=`. AXIS is included now — it is no longer exempt. */
const SVG_TEXT_FILL = new RegExp(String.raw`fill=\{[^}]*\b(?:theme\.)?(?:${PALETTE})\b`)

/**
 * `fill` resolving to the axis color, in EVERY spelling this repo can write it:
 *
 *   fill={AXIS}                     SVG <text>, and recharts <LabelList>
 *   fill={theme.AXIS}               the same, via the theme object
 *   tick={{ fontSize: 12, fill: AXIS }}      recharts prop object
 *   label={{ …, fill: theme.AXIS }}          recharts axis title
 *   { stroke: axis, tick: { fill: axis } }   the shared builders' local param
 *
 * Every one of those paints text. `stroke` is deliberately NOT matched: the
 * rule, the tick marks and the reference lines are graphics, and AXIS clears
 * the 3:1 non-text floor (3.24 light / 3.31 dark at worst).
 */
const FILL_IS_AXIS = /\bfill[=:]\s*\{?\s*(?:theme\.|colors\.)?(?:AXIS|axis)\b/

/**
 * Only files that pull the constants out of `charts/theme` are in scope.
 * `ui/form.tsx` declares its own `const DANGER = 'rgb(var(--danger))'`, which is
 * already a token and must not be reported.
 *
 * 🔴 BOTH import spellings, because the first version of this file knew only one
 * and that one excluded the charts. Neighbours of `theme.ts` import it as
 * `'./theme'`; only files a directory or more away write `'…/charts/theme'`. The
 * original predicate matched the second alone, so the scan covered twin/, ba/,
 * automl/, decision/ and graph/ — and silently skipped BarChartWidget,
 * LineChartWidget, AreaChartWidget, ScatterChartWidget, PieChartWidget,
 * ForecastChartWidget, Sparkline, ScenarioPanel and axis.tsx. The guard written
 * to protect the chart palette could not see the charts.
 *
 * Found by mutation, not by reading: putting `tick={{ fill: theme.AXIS }}` back
 * into ScenarioPanel left the suite green.
 *
 * The sibling test is `^\./[^/]+$` because Vite normalizes glob keys against the
 * IMPORTING file, not against the glob's own base — the pattern starts
 * `../../`, but a neighbour still comes back as `./BarChartWidget.tsx` (a far
 * one as `../twin/TornadoChart.tsx`). Measured; the first attempt matched
 * `/charts/…$` and quietly selected nothing.
 */
const importsTheme = (file: string, src: string) =>
  /from\s+'[^']*charts\/theme'/.test(src) ||
  (/^\.\/[^/]+$/.test(file) && /from\s+'\.\/theme'/.test(src))

/**
 * Every `<name …>` opening tag, sliced exactly.
 *
 * Brace-aware rather than `/<name[^>]*>/`: JSX attribute values legitimately
 * contain `>` (`fill={delta > 0 ? a : b}`), and a naive scan would cut the tag
 * in half and miss the fill.
 */
function jsxTags(src: string, name: string): string[] {
  const open = `<${name}`
  const tags: string[] = []
  for (let i = src.indexOf(open); i !== -1; i = src.indexOf(open, i + open.length)) {
    // `<text` must not also match `<textPath`; `<XAxis` must not match a
    // hypothetical `<XAxisFoo`. The char after the name has to end it.
    if (/[\w-]/.test(src[i + open.length] ?? '')) continue
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

const textTags = (src: string) => jsxTags(src, 'text')
const axisTags = (src: string) => [...jsxTags(src, 'XAxis'), ...jsxTags(src, 'YAxis')]

/** An axis whose tick text recharts would color from `stroke`. */
const STROKE_IS_AXIS = /\bstroke=\{[^}]*\b(?:theme\.)?AXIS\b/
const HAS_TICK_PROP = /\btick=/

const scannable = () =>
  Object.entries(SOURCES).filter(([f, src]) => !/\.test\.tsx?$/.test(f) && importsTheme(f, src))

describe('chart palette constants are never used as text color', () => {
  it('resolved the source glob at all', () => {
    // The failure mode of every source-scanning test is a glob that quietly
    // matches nothing, leaving each assertion below vacuously green. Pinned on
    // the glob — the mechanism that can break — rather than on the number of
    // files importing the palette, which legitimately shrinks as sites migrate.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(200)
    expect(scannable().length).toBeGreaterThan(0)
  })

  it('has the chart widgets themselves in scope', () => {
    // `scannable().length > 0` above was true for a year while every file in
    // this directory sat outside the scan — the other twelve importers kept the
    // count healthy. A count cannot express "the charts are covered", so the
    // files that matter most are named. Losing any of them is now a red test
    // with the missing name in the message, not a quietly smaller number.
    const scanned = scannable().map(([f]) => f.split('/').pop())
    for (const f of [
      'BarChartWidget.tsx',
      'LineChartWidget.tsx',
      'AreaChartWidget.tsx',
      'ScatterChartWidget.tsx',
      'ForecastChartWidget.tsx',
      'ScenarioPanel.tsx',
      'axis.tsx',
      // …and a sample of the far-away importers, so widening never narrows.
      'TornadoChart.tsx',
      'BCGMatrix.tsx',
      'RegressionDiagnostics.tsx',
    ]) {
      expect(scanned, `${f} dropped out of the palette scan`).toContain(f)
    }
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

  it('never fills anything with the axis color', () => {
    // Broader than the SVG rule above on purpose: `fill` reaches text through
    // four different spellings here, and only one of them is a `<text>` tag.
    // <LabelList fill={AXIS}> — the value printed beside each bar — was live
    // when this rule was written and is a tag no `<text>` scan would ever see.
    const offenders: string[] = []
    for (const [file, src] of scannable()) {
      src.split('\n').forEach((line, i) => {
        if (FILL_IS_AXIS.test(line)) offenders.push(`${file}:${i + 1} — ${line.trim().slice(0, 70)}`)
      })
    }
    expect(
      offenders,
      'theme.AXIS is the axis RULE (a graphic, 3:1). Anything filled is read: ' +
        'use theme.INK_SOFT. Keep AXIS on `stroke`.',
    ).toEqual([])
  })

  it('gives every AXIS-stroked recharts axis an explicit tick', () => {
    // The rule that would have caught the old cap's blind spot. recharts spreads
    // `fill: stroke` into its tick props, so an axis with `stroke={AXIS}` and no
    // `tick` paints its labels at 3.24–4.02 — with no `fill` anywhere in the
    // source for the rule above to find. The override is the only thing standing
    // between the axis line's color and the axis label's color; deleting it is
    // silent, so it is asserted rather than trusted.
    const offenders: string[] = []
    for (const [file, src] of scannable()) {
      for (const tag of axisTags(src)) {
        if (STROKE_IS_AXIS.test(tag) && !HAS_TICK_PROP.test(tag)) {
          offenders.push(`${file} — ${tag.replace(/\s+/g, ' ').slice(0, 80)}`)
        }
      }
    }
    expect(
      offenders,
      'recharts defaults tick text to the axis `stroke`. An axis stroked with ' +
        'AXIS must pass tick={{ fill: INK_SOFT }} (or a custom tick element).',
    ).toEqual([])
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
    // AXIS is no longer exempt from the SVG ban.
    expect(SVG_TEXT_FILL.test('<text fill={theme.AXIS}>')).toBe(true)
  })

  it('still finds an axis-colored fill in every spelling it can be written', () => {
    // Each positive is a line that actually stood in this repo before this fix.
    expect(FILL_IS_AXIS.test('<text fontSize={10} fill={theme.AXIS} className="font-mono">')).toBe(true)
    expect(FILL_IS_AXIS.test('<LabelList dataKey={y} position="right" fill={AXIS} />')).toBe(true)
    expect(FILL_IS_AXIS.test('<XAxis dataKey="period" tick={{ fill: theme.AXIS, fontSize: 11 }} />')).toBe(true)
    expect(FILL_IS_AXIS.test("label={{ value: xLabel, position: 'insideBottom', fontSize: 11, fill: AXIS }}")).toBe(true)
    expect(FILL_IS_AXIS.test('tick: longX ? <TruncatedTick /> : { fontSize: 12, fill: axis },')).toBe(true)

    // ...and these must NOT match, or the rule bans the legitimate graphic.
    expect(FILL_IS_AXIS.test('<XAxis stroke={AXIS} tickLine={false} />')).toBe(false)
    expect(FILL_IS_AXIS.test('<line x1={cx} stroke={theme.AXIS} strokeWidth={1} />')).toBe(false)
    expect(FILL_IS_AXIS.test('    stroke: axis,')).toBe(false)
    expect(FILL_IS_AXIS.test('<text fill={theme.INK_SOFT}>')).toBe(false)
    expect(FILL_IS_AXIS.test('tick={{ fontSize: 12, fill: INK_SOFT }}')).toBe(false)
    // Near-miss identifiers must not be swept up by the bare-`axis` alternative.
    expect(FILL_IS_AXIS.test('<text fill={AXIS_LABEL_COLOR}>')).toBe(false)
    expect(FILL_IS_AXIS.test('tick={{ fill: axisTitleInk }}')).toBe(false)
  })

  it('spots an axis that leans on `stroke` for its tick color', () => {
    // The exact shape the retired cap could not see.
    const bare = '<XAxis dataKey="label" stroke={AXIS} fontSize={12} tickLine={false} />'
    expect(STROKE_IS_AXIS.test(bare) && !HAS_TICK_PROP.test(bare)).toBe(true)

    const fixed = '<XAxis dataKey="label" stroke={AXIS} tick={{ fontSize: 12, fill: INK_SOFT }} />'
    expect(STROKE_IS_AXIS.test(fixed) && !HAS_TICK_PROP.test(fixed)).toBe(false)

    // A custom tick element owns its own color — also acceptable.
    const custom = '<YAxis stroke={AXIS} tick={<TruncatedTick max={22} anchor="end" />} />'
    expect(STROKE_IS_AXIS.test(custom) && !HAS_TICK_PROP.test(custom)).toBe(false)

    // An axis not stroked with AXIS is out of scope entirely.
    const other = '<XAxis stroke={GRID} fontSize={12} />'
    expect(STROKE_IS_AXIS.test(other)).toBe(false)
  })

  it('slices axis tags and does not confuse similarly-named elements', () => {
    // `<XAxis` must not swallow `<XAxisFoo`, and the ZAxis in ScatterChartWidget
    // must not be mistaken for an axis that carries ticks.
    expect(axisTags('<XAxis stroke={AXIS} />').length).toBe(1)
    expect(axisTags('<XAxisFoo stroke={AXIS} />').length).toBe(0)
    expect(axisTags('<ZAxis range={[60, 60]} />').length).toBe(0)
    // Brace-aware over a `>` inside an attribute, same as the <text> case.
    const tricky = axisTags('<YAxis stroke={n > 0 ? AXIS : GRID} tick={{ fill: INK_SOFT }} />')
    expect(tricky.length).toBe(1)
    expect(HAS_TICK_PROP.test(tricky[0])).toBe(true)
  })

  it('slices a <text> tag whose attributes contain a `>`', () => {
    // The reason textTags is brace-aware. A naive /<text[^>]*>/ stops at the `>`
    // inside the ternary and never sees the fill.
    const tags = textTags('<text x={1} fill={d > 0 ? theme.ACCENT : theme.INK_SOFT}>hi</text>')
    expect(tags.length).toBe(1)
    expect(SVG_TEXT_FILL.test(tags[0])).toBe(true)
  })
})
