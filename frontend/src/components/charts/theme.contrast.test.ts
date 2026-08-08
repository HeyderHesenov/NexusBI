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
 *   tick={{ fill: n > 3 ? AXIS : INK_SOFT }} the ternary
 *
 * Every one of those paints text. `stroke` is deliberately NOT matched: the
 * rule, the tick marks and the reference lines are graphics, and AXIS clears
 * the 3:1 non-text floor at full opacity (3.24 light / 3.31 dark at worst).
 *
 * 🔴 `[^};]*` before the constant, NOT an anchored match. The first version
 * required the color to sit immediately after `fill:`, so the ternary walked
 * straight past it — the SAME defect `CSS_USE` had been hardened against one
 * screen above, reintroduced in the rule written to replace it. Measured: the
 * ternary form shipped green.
 *
 * The trailing `(?![\w.])` rejects `fill={axis.color}` — an unrelated local
 * named `axis` whose `.color` goes on to a stroke is not this bug, and `\b`
 * alone accepted it.
 */
const FILL_IS_AXIS = /\bfill[=:]\s*\{?[^};]*?\b(?:theme\.|colors\.)?(?:AXIS|axis)(?![\w.])/

/**
 * Comments are stripped before the fill scan.
 *
 * Without this the rule cannot be documented in the code it polices: a line
 * reading `// never write fill: AXIS here` is itself an offender, with no way
 * to opt out. Block-comment bodies are covered by the leading-`*` case, which
 * is how this file's own prose is laid out.
 */
function code(line: string): string {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return ''
  return line.replace(/\/\/.*$/, '')
}

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
 * 🔴 THEN THE FIX WAS ITSELF TOO NARROW. Matching two spellings —
 * `'…/charts/theme'` and a sibling's `'./theme'` — still missed a third:
 * `charts/previews/DonutPreview.tsx` writes `'../theme'`, which has no
 * `charts/` in it and is not a sibling. Enumerating spellings loses to a
 * directory nobody thought about, every time.
 *
 * So the specifier is RESOLVED instead of pattern-matched: join it to the
 * importing file's directory, normalize the `..` segments, and ask whether the
 * result is this module. A fourth layout answers correctly for free.
 *
 * Vite normalizes glob keys against the IMPORTING file, not the glob's base —
 * the pattern starts `../../`, yet a neighbour comes back as
 * `./BarChartWidget.tsx` and a far one as `../twin/TornadoChart.tsx`. Measured;
 * an earlier attempt matched `/charts/…$` and quietly selected nothing.
 */
const THEME_MODULE = 'components/charts/theme'

/** Resolve `spec` relative to `file`'s directory, collapsing `.` and `..`. */
function resolveFrom(file: string, spec: string): string {
  const segments = [...file.split('/').slice(0, -1), ...spec.split('/')]
  const out: string[] = []
  for (const s of segments) {
    if (s === '' || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return out.join('/')
}

const importsTheme = (file: string, src: string) => {
  // Glob keys are relative to charts/; anchor them so resolution has a root.
  const from = resolveFrom('components/charts/_', file)
  for (const [, spec] of src.matchAll(/from\s+'([^']+)'/g)) {
    if (!spec.startsWith('.')) continue
    if (resolveFrom(from, spec) === THEME_MODULE) return true
  }
  return false
}

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

/** The brace-balanced value of `name={…}` inside a tag, or null. */
function attrValue(tag: string, name: string): string | null {
  const at = tag.indexOf(`${name}={`)
  if (at === -1) return null
  const open = at + name.length + 1
  let depth = 0
  for (let i = open; i < tag.length; i++) {
    if (tag[i] === '{') depth++
    else if (tag[i] === '}' && --depth === 0) return tag.slice(open + 1, i)
  }
  return null
}

/** Every balanced `{…}` object literal inside a snippet. */
function objectLiterals(src: string): string[] {
  const out: string[] = []
  for (let i = src.indexOf('{'); i !== -1; i = src.indexOf('{', i + 1)) {
    let depth = 0
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}' && --depth === 0) {
        out.push(src.slice(i, j + 1))
        i = j
        break
      }
    }
  }
  return out
}
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
      // A nested directory, which two successive versions of the file filter
      // excluded — first by requiring `charts/` in the specifier, then by
      // requiring the importer to be a direct sibling.
      'DonutPreview.tsx',
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
        if (FILL_IS_AXIS.test(code(line)))
          offenders.push(`${file}:${i + 1} — ${line.trim().slice(0, 70)}`)
      })
    }
    expect(
      offenders,
      'theme.AXIS is the axis RULE (a graphic, 3:1). Anything filled is read: ' +
        'use theme.INK_SOFT. Keep AXIS on `stroke`.',
    ).toEqual([])
  })

  it('gives every recharts axis title an explicit fill', () => {
    // The tick rule below covers the labels; the axis TITLE is a separate text
    // node with a separate default. recharts falls back to a hardcoded #808080
    // for it, which measures 3.58–3.95 light and 3.77–4.58 dark — failing AA on
    // five of six surface/mode combinations, and never mentioning AXIS, so
    // neither the fill ban nor the tick rule would say a word.
    //
    // ⚠️ Brace-balanced, not `label={{…}}`. The first version of this rule
    // matched the doubled brace and therefore only saw the direct form, while
    // half the axes in this repo write the conditional one —
    // `label={cond ? { value, … } : undefined}` — so the shape it missed is the
    // more common shape. Measured: deleting the fill from ScatterChartWidget's
    // x-axis title left it green. Same narrowing this file has now made three
    // times; the fix is to parse the structure rather than a spelling of it.
    const offenders: string[] = []
    for (const [file, src] of scannable()) {
      for (const tag of axisTags(src)) {
        const label = attrValue(tag, 'label')
        if (label === null) continue
        // A `value:` object is a rendered title; every one of them needs a fill.
        for (const obj of objectLiterals(label)) {
          if (/\bvalue\s*:/.test(obj) && !/\bfill\s*:/.test(obj)) {
            offenders.push(`${file} — ${obj.replace(/\s+/g, ' ').slice(0, 80)}`)
          }
        }
      }
    }
    expect(
      offenders,
      'An axis `label` with no `fill` renders at recharts’ #808080 default, ' +
        'which fails AA. Pass fill: INK_SOFT.',
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
    // The ternary. The anchored first version shipped green on exactly this.
    expect(FILL_IS_AXIS.test('tick={{ fill: n > 3 ? theme.AXIS : theme.INK_SOFT, fontSize: 11 }}')).toBe(true)
    expect(FILL_IS_AXIS.test('<text fill={up ? theme.INK_SOFT : theme.AXIS}>')).toBe(true)

    // ...and these must NOT match, or the rule bans the legitimate graphic.
    expect(FILL_IS_AXIS.test('<XAxis stroke={AXIS} tickLine={false} />')).toBe(false)
    expect(FILL_IS_AXIS.test('<line x1={cx} stroke={theme.AXIS} strokeWidth={1} />')).toBe(false)
    expect(FILL_IS_AXIS.test('    stroke: axis,')).toBe(false)
    expect(FILL_IS_AXIS.test('<text fill={theme.INK_SOFT}>')).toBe(false)
    expect(FILL_IS_AXIS.test('tick={{ fontSize: 12, fill: INK_SOFT }}')).toBe(false)
    // Near-miss identifiers must not be swept up by the bare-`axis` alternative.
    expect(FILL_IS_AXIS.test('<text fill={AXIS_LABEL_COLOR}>')).toBe(false)
    expect(FILL_IS_AXIS.test('tick={{ fill: axisTitleInk }}')).toBe(false)
    // A local object that merely happens to be named `axis`.
    expect(FILL_IS_AXIS.test('<line fill={axis.color} />')).toBe(false)
    expect(FILL_IS_AXIS.test('<text fill={theme.AXIS_LIKE}>')).toBe(false)
    // `;` bounds the search so a later statement cannot be dragged in.
    expect(FILL_IS_AXIS.test('const fill = INK_SOFT; const other = AXIS')).toBe(false)
  })

  it('lets the rule be written down without failing on itself', () => {
    // A guard that cannot be documented in the file it guards gets documented
    // wrongly, or not at all.
    expect(code('  // never write fill: AXIS here — use INK_SOFT')).toBe('')
    expect(code('   * `fill={theme.AXIS}` is the shape this bans.')).toBe('')
    expect(code('  /* fill: AXIS */')).toBe('')
    expect(FILL_IS_AXIS.test(code('<text fill={theme.INK_SOFT}> // not fill: AXIS'))).toBe(false)
    // …while real code on the same line is still read.
    expect(FILL_IS_AXIS.test(code('<text fill={theme.AXIS}> // the offender'))).toBe(true)
  })

  it('resolves every import spelling to the same module', () => {
    // Enumerating spellings is what let previews/ slip through twice.
    const t = "import { useChartTheme } from '%s'"
    expect(importsTheme('./BarChartWidget.tsx', t.replace('%s', './theme'))).toBe(true)
    expect(importsTheme('./previews/DonutPreview.tsx', t.replace('%s', '../theme'))).toBe(true)
    expect(importsTheme('../twin/TornadoChart.tsx', t.replace('%s', '../charts/theme'))).toBe(true)
    expect(importsTheme('../../pages/Deep.tsx', t.replace('%s', '../components/charts/theme'))).toBe(true)
    // …and modules that are not this one stay out.
    expect(importsTheme('../ui/form.tsx', t.replace('%s', './theme'))).toBe(false)
    expect(importsTheme('../../store/themeStore.ts', t.replace('%s', './themeStore'))).toBe(false)
    expect(importsTheme('./BarChartWidget.tsx', "import { x } from 'recharts'")).toBe(false)
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

  it('reads an axis title in both spellings it is written in', () => {
    // Pins the parser against the exact two forms live in this repo. The
    // conditional one is what the doubled-brace version of this rule missed.
    const direct = '<XAxis label={{ value: "Month", fontSize: 11, fill: INK_SOFT }} />'
    const conditional =
      '<XAxis label={ xLabel ? { value: xLabel, fontSize: 11, fill: INK_SOFT } : undefined } />'
    for (const tag of [direct, conditional]) {
      const v = attrValue(tag, 'label')
      expect(v, tag).not.toBeNull()
      const titles = objectLiterals(v as string).filter((o) => /\bvalue\s*:/.test(o))
      expect(titles, `no title object found in ${tag}`).toHaveLength(1)
      expect(/\bfill\s*:/.test(titles[0])).toBe(true)
    }
    // …and the same two with the fill removed must be detected as offenders.
    for (const tag of [
      '<XAxis label={{ value: "Month", fontSize: 11 }} />',
      '<XAxis label={ x ? { value: x, fontSize: 11 } : undefined } />',
    ]) {
      const titles = objectLiterals(attrValue(tag, 'label') as string).filter((o) =>
        /\bvalue\s*:/.test(o),
      )
      expect(titles).toHaveLength(1)
      expect(/\bfill\s*:/.test(titles[0])).toBe(false)
    }
    // An axis with no title at all is not an offender.
    expect(attrValue('<XAxis stroke={AXIS} />', 'label')).toBeNull()
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
