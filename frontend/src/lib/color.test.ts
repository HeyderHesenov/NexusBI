import { describe, expect, it } from 'vitest'
import { deriveAccentVariants, hexToRgb, hexToTriplet, readableTextColor, relativeLuminance } from './color'

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
})
