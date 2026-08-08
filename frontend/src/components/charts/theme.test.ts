import { describe, expect, it } from 'vitest'
import { chartTheme, DANGER, HEALTH_COLOR } from './theme'
import type { GraphHealthStatus } from '../../types'

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** WCAG 2.x contrast ratio, `(L1 + 0.05) / (L2 + 0.05)`. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The surfaces a chart can sit on, straight from `index.css`. */
const BACKGROUNDS = {
  light: { '--bg': '#FAF9F5', '--surface': '#FFFFFF', '--surface-2': '#F5F4EE' },
  dark: { '--bg': '#171615', '--surface': '#1F1E1D', '--surface-2': '#292725' },
} as const

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

  it.each(MODES)('INK_SOFT clears AA for text in %s mode', (mode) => {
    const { INK_SOFT } = chartTheme(mode)
    for (const [name, bg] of Object.entries(BACKGROUNDS[mode])) {
      // Measured when written: light 6.52–7.18, dark 5.94–7.21.
      expect(contrast(INK_SOFT, bg), `INK_SOFT on ${name} (${mode})`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(MODES)('AXIS clears the 3:1 non-text floor in %s mode', (mode) => {
    // AXIS keeps stroking the rules, tick marks and reference lines, so it must
    // stay above the graphics floor — but it is NOT text-safe, which is the
    // whole reason tick labels were moved off it. Measured when written:
    // light 3.24–3.57, dark 3.31–4.02 — over 3, under 4.5, in both modes.
    const { AXIS } = chartTheme(mode)
    for (const [name, bg] of Object.entries(BACKGROUNDS[mode])) {
      expect(contrast(AXIS, bg), `AXIS on ${name} (${mode})`).toBeGreaterThanOrEqual(3)
    }
  })

  it('measures a known pair correctly', () => {
    // The scoring function is the thing every assertion above trusts, so it is
    // pinned against hand-computed values rather than assumed.
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5)
    expect(contrast('#5B5750', '#FFFFFF')).toBeCloseTo(7.18, 1)
    expect(contrast('#8C877E', '#FFFFFF')).toBeCloseTo(3.57, 1)
  })
})
