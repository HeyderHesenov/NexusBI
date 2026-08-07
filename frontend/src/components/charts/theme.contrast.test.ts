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
 *   DANGER  #D87C6B   2.72 – 2.99   (also fails the 3:1 graphics floor)
 *   ACCENT  #0E9F6E   3.07 – 3.39
 *
 * Both are below the 4.5:1 that body text owes, and every site that had this was
 * small text (`text-xs` / `text-sm` / SVG `fontSize` 10–12), so the large-text
 * 3:1 exemption never applied. In dark mode the same hexes ARE the token values
 * (`--danger` = 216 124 107 = #D87C6B, `--accent` = 16 185 129 = #10B981), which
 * is why the fix — moving text onto the tokens — changes light mode only.
 *
 * The rule: hex for `stroke` / `fill` / `background`, tokens for `color`.
 *
 * KNOWN LIMIT, stated rather than papered over: this catches the direct form,
 * `color: DANGER`, which is how seven of the nine original sites were written.
 * It cannot see indirection — `{ color: meta.color }` fed from a lookup table —
 * and the other two (PorterForces, MonteCarloPanel) were exactly that shape and
 * had to be found by reading. Those two are pinned by their own component tests
 * instead. A green run here means the direct form is absent, not that a file is
 * clean.
 */
import { describe, expect, it } from 'vitest'

// Vite's own raw-import glob rather than node:fs. The frontend has no
// @types/node — `tsc -b` rejects `import { readFileSync } from 'node:fs'` with
// TS2307 — and a scan helper is not worth pulling a new devDependency in for.
// The glob is resolved by Vite at transform time, so it also needs no path
// arithmetic against process.cwd().
const SOURCES: Record<string, string> = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/**
 * The text form: a `color:` that lands in a `style` prop.
 *
 * `style=` is required on the line, and that is not decoration. `color:` is also
 * an ordinary key in this codebase's palette lookup tables —
 * `{ key: 'weaknesses', color: DANGER }` in SWOTGrid, `{ label: 'P50', color:
 * theme.ACCENT }` in MonteCarloPanel — where the value goes on to a `background`
 * or a `stroke` and is perfectly correct. Matching bare `color:` reported all
 * four of those as violations. Anchoring on `style=` keeps the rule pointed at
 * CSS rather than at any object with a field named color.
 */
const TEXT_USE = /style=.*\bcolor:\s*(?:theme\.)?(DANGER|ACCENT)\b/

/** Only files that pull the constants out of `charts/theme` are in scope.
 *  `ui/form.tsx` declares its own `const DANGER = 'rgb(var(--danger))'`, which is
 *  already a token and must not be reported. */
const IMPORTS_THEME = /from\s+'[^']*charts\/theme'/

describe('chart palette constants are never used as text color', () => {
  it('has no `color: DANGER` / `color: theme.ACCENT` outside the tokens', () => {
    const offenders: string[] = []
    const scanned: string[] = []

    for (const [file, src] of Object.entries(SOURCES)) {
      if (/\.test\.tsx?$/.test(file)) continue
      if (!IMPORTS_THEME.test(src)) continue
      scanned.push(file)
      src.split('\n').forEach((line, i) => {
        if (TEXT_USE.test(line)) offenders.push(`${file}:${i + 1}`)
      })
    }

    // A glob that silently resolved to nothing would make this assertion vacuous
    // — the failure mode of every source-scanning test. Pin that it saw the real
    // consumers, not an empty set.
    expect(scanned.length).toBeGreaterThan(10)

    expect(
      offenders,
      'Use rgb(var(--danger)) / rgb(var(--accent)) (or the text-danger / ' +
        'text-accent classes) for text. The hex constants are for stroke, fill ' +
        'and background only — as text they measure 2.72–3.39:1 in light mode.',
    ).toEqual([])
  })

  it('still finds the violation when one is introduced', () => {
    // Pins the matcher itself: a ratchet that cannot fail is decoration. Every
    // spelling below is one that actually stood in this repo before the fix.
    expect(TEXT_USE.test('style={{ color: DANGER }}')).toBe(true)
    expect(TEXT_USE.test('style={up ? undefined : { color: DANGER }}')).toBe(true)
    expect(TEXT_USE.test('style={d >= 0 ? { color: theme.ACCENT } : { color: DANGER }}')).toBe(true)

    // ...and these must NOT match, or the rule would ban the palette itself.
    expect(TEXT_USE.test('fill={DANGER}')).toBe(false)
    expect(TEXT_USE.test('stroke={theme.ACCENT}')).toBe(false)
    expect(TEXT_USE.test('style={{ background: DANGER }}')).toBe(false)
    // The palette-map form — a `color` field feeding a background/stroke later.
    expect(TEXT_USE.test("  { key: 'weaknesses', color: DANGER },")).toBe(false)
    expect(TEXT_USE.test("  { v: result.p50, label: 'P50', color: theme.ACCENT },")).toBe(false)
  })
})
