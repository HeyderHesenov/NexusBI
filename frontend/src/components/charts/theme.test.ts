import { describe, expect, it } from 'vitest'
import { chartTheme, DANGER, HEALTH_COLOR } from './theme'
import { contrastRatio } from '../../lib/color'
import type { GraphHealthStatus } from '../../types'
// `?raw` resolves to the file only because vite.config.ts sets `test.css: true`
// — with vitest's default the import silently yields an empty string, and every
// ratio below would score against a token table that parsed to nothing. The
// "reads the surfaces out of index.css" test is what makes that loud.
import indexCss from '../../index.css?raw'

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

describe('HEALTH_COLOR', () => {
  it('maps every health severity to a hex color', () => {
    const severities: GraphHealthStatus[] = ['ok', 'warn', 'danger', 'unknown']
    for (const s of severities) {
      expect(HEALTH_COLOR[s]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('reuses the app-wide DANGER color for the danger severity', () => {
    expect(HEALTH_COLOR.danger).toBe(DANGER)
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
      expect(contrastRatio(INK_SOFT, bg), `INK_SOFT on ${name} (${mode})`).toBeGreaterThanOrEqual(4.5)
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
      expect(contrastRatio(AXIS, bg), `AXIS on ${name} (${mode})`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps AXIS below the text threshold it was moved off', () => {
    // The other half of the split. Without this, someone could darken AXIS to
    // 5:1, leave every label on INK_SOFT, and the two tokens would silently
    // become interchangeable — at which point the whole distinction is dead
    // code and the next person reintroduces `fill={AXIS}` reasonably.
    for (const mode of MODES) {
      const { AXIS } = chartTheme(mode)
      const worst = Math.min(...backgrounds(mode).map(([, bg]) => contrastRatio(AXIS, bg)))
      expect(worst, `AXIS in ${mode} now clears AA — collapse the two tokens or re-scope`).toBeLessThan(4.5)
    }
  })
})
