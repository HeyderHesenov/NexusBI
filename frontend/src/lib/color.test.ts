import { describe, expect, it } from 'vitest'
import {
  BRETTEL,
  collapseLinear,
  composite,
  deriveAccentVariants,
  hexToRgb,
  hexToTriplet,
  readableTextColor,
  relativeLuminance,
} from './color'

describe('color', () => {
  it('loses nothing by folding three sRGB transfer curves into one', () => {
    // This file grew three copies of the curve — relativeLuminance used WCAG's
    // 0.03928 breakpoint, the two dichromacy helpers used the sRGB spec's
    // 0.04045 — inside the same 152 lines, under a docstring explaining that the
    // function was exported precisely so there would not be two.
    //
    // Consolidating on 0.04045 is only safe if no 8-bit channel falls between the
    // two breakpoints. It does not: WCAG's breaks at 255 × 0.03928 = 10.016 and
    // the spec's at 10.31, so both put 0-10 on the linear branch and 11-255 on
    // the power branch. Asserted over the whole domain rather than argued,
    // because every caller feeds integers (hexToRgb parses them, `mix` rounds)
    // and that is the premise the consolidation rests on.
    const wcag = (c: number) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    for (let c = 0; c <= 255; c++) {
      expect(relativeLuminance([c, c, c]), `channel ${c} diverges between the two breakpoints`)
        .toBeCloseTo(wcag(c), 12)
    }
  })

  it('parses hex to rgb and triplet (with/without #, case-insensitive)', () => {
    expect(hexToRgb('#0E9F6E')).toEqual([14, 159, 110])
    expect(hexToRgb('0e9f6e')).toEqual([14, 159, 110])
    expect(hexToTriplet('#FF5500')).toBe('255 85 0')
  })

  it('returns null for malformed hex', () => {
    expect(hexToRgb('red')).toBeNull()
    expect(hexToRgb('#abc')).toBeNull() // 3-digit unsupported (matches backend contract)
    expect(hexToTriplet('nope')).toBeNull()
  })

  it('picks legible text color by luminance', () => {
    expect(readableTextColor('#FFFF00')).toBe('#1F1E1D') // bright yellow → dark text
    expect(readableTextColor('#FFFFFF')).toBe('#1F1E1D')
    expect(readableTextColor('#000080')).toBe('#FFFFFF') // navy → white text
    expect(readableTextColor('#0E9F6E')).toBe('#FFFFFF') // brand emerald → white text
    expect(readableTextColor('bad')).toBe('#FFFFFF') // safe default
  })

  it('derives press (darker) + theme-aware soft triplets', () => {
    const light = deriveAccentVariants('#0E9F6E', false)!
    const dark = deriveAccentVariants('#0E9F6E', true)!
    // press is a valid "r g b" triplet and darker than the source on every channel
    const press = light.press.split(' ').map(Number)
    expect(press).toEqual(dark.press.split(' ').map(Number))
    expect(press[1]).toBeLessThan(159)
    // soft differs by theme (light tint vs dark tint)
    expect(light.soft).not.toBe(dark.soft)
    // light soft is near-white (high channels), dark soft is dark (low channels)
    expect(Math.min(...light.soft.split(' ').map(Number))).toBeGreaterThan(180)
    expect(Math.max(...dark.soft.split(' ').map(Number))).toBeLessThan(120)
  })

  it('returns null variants for bad hex', () => {
    expect(deriveAccentVariants('xyz', false)).toBeNull()
  })

  it('composites toward the backdrop, and is pinned by its own endpoints', () => {
    // ⚠️ WRITTEN BECAUSE A MUTATION SURVIVED. Replacing the body with
    // `f.map((c) => Math.round(c))` — i.e. ignoring alpha entirely and returning
    // the foreground — left all 49 trust-ring and palette assertions green.
    //
    // The reason is worth keeping: every caller asserts a FLOOR, and dropping the
    // blend moves each ratio AWAY from its backdrop, so a broken composite makes
    // the numbers look better and every `toBeGreaterThanOrEqual` still passes.
    // That is the same shape as the metric mutation that survived the dichromacy
    // work — the converter was anchored and the thing measuring with it was not.
    // A helper only used through inequalities has to be pinned by identities.
    //
    // alpha 0 is the one the mutation cannot fake: it demands the BACKDROP back.
    expect(composite('#AB4A37', '#FFFFFF', 0)).toBe('#ffffff')
    expect(composite('#AB4A37', '#FFFFFF', 1)).toBe('#ab4a37')
    // Half of black over white is mid grey — fixes the direction AND the scale,
    // so a blend that ran backwards or at half strength cannot pass either.
    expect(composite('#000000', '#FFFFFF', 0.5)).toBe('#808080')
    expect(composite('#FFFFFF', '#000000', 0.25)).toBe('#404040')
  })

  it('throws on a malformed hex rather than compositing nonsense', () => {
    expect(() => composite('nope', '#FFFFFF', 0.5)).toThrow(/malformed/)
    expect(() => composite('#FFFFFF', 'nope', 0.5)).toThrow(/malformed/)
  })

  it('throws on an alpha outside 0..1 instead of formatting a negative channel', () => {
    // The blend is convex only inside [0,1]; outside it the channels leave 0-255
    // and the hex formatting produced garbage SILENTLY, from a function whose
    // docstring promises the opposite. Measured before the guard: 1.2 over white
    // gave '#-33-33-33' and a NaN alpha gave '#NaNNaNNaN' — strings that would
    // then flow into contrastRatio and come back as NaN, and NaN passes no
    // comparison, so a suite built on `toBeGreaterThanOrEqual` would report the
    // ring as failing for a reason that has nothing to do with the ring.
    //
    // NaN is not hypothetical: `ForceGraph.test` feeds this an alpha multiplied
    // out of DOM opacity values, where one `opacity: inherit` on an ancestor is
    // all it takes.
    for (const bad of [1.2, -0.5, NaN, Infinity]) {
      expect(() => composite('#000000', '#FFFFFF', bad), `alpha ${bad}`).toThrow(/out-of-range/)
    }
    // The endpoints are legal and must stay so — an over-eager guard here would
    // break every caller that composites at full or zero opacity.
    expect(() => composite('#000000', '#FFFFFF', 0)).not.toThrow()
    expect(() => composite('#000000', '#FFFFFF', 1)).not.toThrow()
  })
})

/**
 * The 27 numbers behind `collapseLinear` are TRANSCRIBED, from libDaltonLens.
 * Until this block existed they were also unasserted — nothing in the repo
 * referenced `BRETTEL` or `collapseLinear`, while the docstring on both claimed
 * they were "checked" and "exported for the tests". This is that claim, made true.
 *
 * None of the four properties below retypes a constant. Each one is a fact that
 * has to hold if these are the matrices the paper describes, and each is broken by
 * a different mistake: a mistyped digit, a matrix that is not a projection, a
 * hinge that is a cliff, and — the one the other three cannot see — a model that
 * quietly uses one half-plane for everything, which is exactly the Viénot 1999
 * collapse this replaced.
 */
describe('the Brettel 1997 two-half-plane model', () => {
  const KINDS = ['protan', 'deutan', 'tritan'] as const

  /**
   * Linear light for one 8-bit channel — WITHOUT adding a fourth copy of the sRGB
   * curve to the file whose first test exists to stop precisely that.
   *
   * `relativeLuminance`'s three coefficients sum to exactly 1, so for a grey the
   * weighted sum collapses to the channel's own linear value. That identity is the
   * whole trick, so it is asserted below rather than trusted.
   */
  const lin = (c: number) => relativeLuminance([c, c, c])
  const linOf = (hex: string) => hexToRgb(hex)!.map(lin)
  const apply = (m: number[], v: number[]) =>
    [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2])
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const widest = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])))

  /**
   * The constants are published to five decimals, and every structural identity
   * below therefore holds to ~1e-5 rather than exactly. Measured worst residual
   * across all three conditions: row sums 1.0e-5, P·P−P 7.7e-6, hinge 9.3e-6.
   * Precision 4 (|diff| < 5e-5) clears all of them with room, and is still far
   * tighter than any single mistyped digit could survive.
   */
  const PLACES = 4

  it('reads one linear channel off relativeLuminance instead of copying the curve', () => {
    // If the coefficients ever stop summing to 1, `lin` silently becomes a scaled
    // version of the transfer curve and every matrix identity below would be
    // asserted against the wrong vector — while still looking self-consistent.
    for (const c of [0, 1, 10, 11, 128, 254, 255]) {
      expect(relativeLuminance([c, c, c]), `grey ${c}`).toBeCloseTo(lin(c), 15)
    }
    // …and the curve is not the identity, which is what makes it worth having.
    expect(lin(128)).toBeLessThan(128 / 255)
    expect(lin(0)).toBe(0)
    expect(lin(255)).toBeCloseTo(1, 12)
  })

  it('leaves greys alone: every row sums to 1 and the hinge contains the neutral axis', () => {
    // A dichromat loses hue, not lightness, so a grey has nothing to lose and must
    // come back unchanged. On the matrix that is "each row sums to 1"; on the plane
    // it is "the normal is perpendicular to [1,1,1]", which is what puts the whole
    // neutral axis ON the hinge and so makes the choice of half irrelevant for it.
    for (const kind of KINDS) {
      const { m1, m2, normal } = BRETTEL[kind]
      for (const [name, m] of [['m1', m1], ['m2', m2]] as const) {
        for (const r of [0, 1, 2]) {
          const sum = m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2]
          expect(sum, `${kind} ${name} row ${r}`).toBeCloseTo(1, PLACES)
        }
      }
      expect(dot(normal, [1, 1, 1]), `${kind} hinge excludes the neutral axis`).toBeCloseTo(0, 10)
    }
    // Stated once end-to-end, through the exported function rather than the table:
    // whatever the halves do, a grey survives both of them.
    for (const kind of KINDS) {
      for (const grey of ['#000000', '#404040', '#808080', '#C0C0C0', '#FFFFFF']) {
        const out = collapseLinear(grey, kind)!
        const v = linOf(grey)
        expect(widest(out, v), `${kind} moved the grey ${grey}`).toBeLessThan(5e-5)
      }
    }
  })

  it('is made of projections: P·P = P for both halves', () => {
    // A dichromat's view of a dichromat's view is the same view. Plenty of
    // plausible 3×3 matrices darken or tint on a second application; a projection
    // onto the reduced gamut cannot, and that is the property that says these
    // collapse a dimension rather than merely mix channels.
    for (const kind of KINDS) {
      for (const name of ['m1', 'm2'] as const) {
        const m = BRETTEL[kind][name]
        for (const r of [0, 1, 2]) {
          // Row r of P·P is P applied to row r of P, read column-wise.
          const col = (c: number) => [m[c], m[3 + c], m[6 + c]]
          const rowOfSquare = [0, 1, 2].map((c) => dot(m.slice(r * 3, r * 3 + 3), col(c)))
          for (const c of [0, 1, 2]) {
            expect(rowOfSquare[c], `${kind} ${name} (P·P)[${r}][${c}]`).toBeCloseTo(
              m[r * 3 + c],
              PLACES,
            )
          }
        }
      }
    }
  })

  it('hinges rather than steps: the two halves agree on the boundary plane', () => {
    // The halves meet at the plane through the neutral axis. If they disagreed
    // there, two colours a hair apart either side would simulate to visibly
    // different results — a cliff in the middle of the gamut, which would show up
    // as noise in every ΔE measured near it.
    for (const kind of KINDS) {
      const { m1, m2, normal } = BRETTEL[kind]
      // Two independent directions that lie IN the plane: the neutral axis, and an
      // arbitrary vector with its normal component projected out.
      const w = [0.7, 0.2, 0.5]
      const t = dot(normal, w) / dot(normal, normal)
      const inPlane = [[1, 1, 1], w.map((x, i) => x - t * normal[i])]
      for (const [i, v] of inPlane.entries()) {
        expect(dot(normal, v), `${kind} probe ${i} is not actually on the hinge`).toBeCloseTo(0, 10)
        expect(widest(apply(m1, v), apply(m2, v)), `${kind} halves disagree on the hinge`)
          .toBeLessThan(5e-5)
      }
    }
  })

  it('actually uses BOTH halves, and picks by the sign the docstring names', () => {
    // ⚠️ THE OTHER THREE PROPERTIES ALL HOLD FOR A ONE-PLANE MODEL. Rows still sum
    // to 1, m1 is still a projection, and the halves still agree on the hinge if
    // the code never consults the hinge at all — so "always take m1", i.e. the
    // Viénot 1999 collapse this branch replaced, passes every one of them. The
    // property that names the change has to be asserted separately, and it is the
    // reason this test knows about `apply` at all: the counterfactual "what the
    // other half would have said" cannot be expressed without applying it.
    //
    // Probes are the sRGB primaries because they straddle each hinge with the
    // widest margin; the chart palette straddles all three too (measured 10/4
    // protan, 4/10 deutan, 8/6 tritan over its 14 colours), but pinning the split
    // of a palette that is about to be re-picked would be pinning the wrong thing.
    const PROBES = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF']
    for (const kind of KINDS) {
      const { m1, m2, normal } = BRETTEL[kind]
      const sides = new Set<string>()
      let sharpest = 0
      for (const hex of PROBES) {
        const v = linOf(hex)
        const onM1 = dot(normal, v) >= 0
        sides.add(onM1 ? 'm1' : 'm2')
        const got = collapseLinear(hex, kind)!
        // Same arithmetic on the same exported matrix, so this is exact — a
        // tolerance here would let a half-swap hide inside rounding.
        expect(widest(got, apply(onM1 ? m1 : m2, v)), `${kind} ${hex} took the wrong half`)
          .toBeLessThan(1e-12)
        sharpest = Math.max(sharpest, widest(apply(m1, v), apply(m2, v)))
      }
      expect([...sides].sort(), `${kind} never leaves one half-plane`).toEqual(['m1', 'm2'])
      // …and the two halves must be far enough apart that the choice is not
      // cosmetic. Measured margins: protan 0.038, deutan 0.026, tritan 0.452 —
      // against a structural tolerance three orders of magnitude smaller.
      expect(sharpest, `${kind} halves are interchangeable, so the hinge is decorative`)
        .toBeGreaterThan(0.01)
    }
  })

  it('returns null for a malformed hex instead of projecting garbage', () => {
    for (const kind of KINDS) expect(collapseLinear('nope', kind), kind).toBeNull()
  })
})
