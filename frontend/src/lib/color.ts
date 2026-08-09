/** Shared color helpers for white-label branding (embed re-skin + brand preview). */

export type Rgb = [number, number, number]

/** Parse `#rrggbb` (with or without `#`) → [r,g,b], or null if malformed. */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim())
  if (!m) return null
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

/** `#rrggbb` → the `"r g b"` triplet a CSS custom property expects, or null. */
export function hexToTriplet(hex: string): string | null {
  const rgb = hexToRgb(hex)
  return rgb ? rgb.join(' ') : null
}

/**
 * The sRGB transfer function: one 0-255 channel → linear light in [0,1].
 *
 * THE ONE COPY, deliberately. `relativeLuminance`'s docstring used to explain
 * that it was exported so the repo would not carry two implementations of this
 * curve — and then the dichromacy work added two more inside this same file,
 * with a different threshold (0.04045, the sRGB spec's, against WCAG's 0.03928).
 *
 * ⚠️ Those two constants are interchangeable HERE and the test proves it for all
 * 256 inputs: the WCAG figure breaks at 8-bit value 10.016 and the spec figure at
 * 10.31, so no integer channel falls between them, and every caller feeds
 * integers (hexToRgb parses them; `mix` rounds). The spec value is kept because
 * it is the one the other two copies used, so consolidating changed nothing —
 * which is the point, and is asserted rather than assumed.
 */
function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/**
 * Perceived (sRGB) relative luminance in [0,1].
 *
 * Exported because `charts/theme.test` needs the same curve to assert the light
 * palette's luminance SPREAD — a property `contrastRatio` cannot express, since
 * it collapses two luminances into one ratio.
 */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

/**
 * Black or white text that stays legible on `hex` — fixes the "white-on-light"
 * contrast bug. Returns the app's dark ink for light backgrounds, white otherwise.
 */
export function readableTextColor(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return '#FFFFFF'
  return relativeLuminance(rgb) > 0.5 ? '#1F1E1D' : '#FFFFFF'
}

/** WCAG contrast ratio between two hex colors, in [1, 21]. 0 if either is malformed. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return 0
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * CIELAB (D65) for `rgb`. Perceptual space — equal steps look equally different,
 * which sRGB distance does not.
 */
export function toLab([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const [fx, fy, fz] = [f(X), f(Y), f(Z)]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/**
 * Perceptual distance between two hex colours (CIE76 ΔE). **NaN** if either is
 * malformed.
 *
 * ⚠️ It returned 0 with the rationale "callers assert a FLOOR, so a malformed hex
 * fails loudly rather than passing" — and the commit that wrote that sentence
 * also wrote an assertion in the other direction (`toBeLessThan(SEPARATION)`, the
 * red/green collapse anchor), where 0 passes silently and makes the anchor
 * vacuous. NaN is the only value that fails BOTH a floor and a ceiling, so the
 * guarantee no longer depends on every future caller choosing one direction.
 *
 * ⚠️ CIE76, not CIEDE2000, and that is a real limitation rather than a detail:
 * measured on this palette, CIE76 does not even pick the same worst pair —
 * see the SEPARATION note in `charts/theme.test`.
 *
 * Rough reading: under ~2.3 is invisible to most people, ~10 is the smallest
 * difference that survives a small mark on a busy chart.
 */
export function deltaE(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return NaN
  const [la, lb] = [toLab(a), toLab(b)]
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2])
}

export type Dichromacy = 'protan' | 'deutan' | 'tritan'

// Viénot, Brettel & Mollon (1999): convert to LMS, collapse the missing cone's
// axis onto the plane the other two span, convert back. The standard model, and
// the one every colour-blindness simulator is a variation of.
const RGB_TO_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
]
const LMS_TO_RGB = [
  [0.080944, -0.130504, 0.116721],
  [-0.0102485, 0.0540194, -0.113615],
  [-0.000365294, -0.00412163, 0.693513],
]
const COLLAPSE: Record<Dichromacy, number[][]> = {
  protan: [[0, 2.02344, -2.5258], [0, 1, 0], [0, 0, 1]],
  deutan: [[1, 0, 0], [0.494207, 0, 1.24827], [0, 0, 1]],
  tritan: [[1, 0, 0], [0, 1, 0], [-0.395913, 0.801109, 0]],
}
const apply = (m: number[][], v: number[]) => m.map((row) => row.reduce((s, k, i) => s + k * v[i], 0))

/** Linear-light RGB after the collapse, BEFORE gamut clipping. Null if malformed. */
function collapseLinear(hex: string, kind: Dichromacy): number[] | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return apply(LMS_TO_RGB, apply(COLLAPSE[kind], apply(RGB_TO_LMS, rgb.map(srgbToLinear))))
}

/**
 * How far outside [0,1] the collapse threw `hex`, in linear units; 0 when the
 * simulated colour is representable. NaN if malformed.
 *
 * ⚠️ THIS IS NOT A CURIOSITY. `simulateDichromacy` clamps out-of-gamut output
 * silently, so for a colour that clips, the returned hex is not what the model
 * says — it is the nearest colour a screen can show, and any ΔE measured from it
 * is measuring the clamp as much as the condition. Four of the six dark SERIES
 * clip under tritan (worst 0.773), so the tritan column is the soft one. Pinned
 * in `charts/theme.test` rather than left invisible, and the reason the tritan
 * model is a ticket: Viénot/Brettel/Mollon validated the single-plane
 * construction for protan and deutan; tritanopia needs Brettel's two half-planes.
 */
export function dichromacyGamutError(hex: string, kind: Dichromacy): number {
  const out = collapseLinear(hex, kind)
  if (!out) return NaN
  return Math.max(0, ...out.map((c) => Math.max(-c, c - 1)))
}

/**
 * `hex` as someone with `kind` dichromacy sees it, or null if malformed.
 *
 * Used to assert that two chart series stay apart for a reader who cannot use
 * hue. ⚠️ Dichromacy deletes ONE opponent axis, it does not leave lightness
 * alone: a deuteranope loses red-green and keeps blue-yellow, so two colours at
 * identical lightness can still be far apart — SERIES[1]/SERIES[4] are 0.4 L*
 * apart and score ΔE 43 here. An earlier version of this comment claimed
 * lightness was "the only signal left", which is what made the palette's own
 * justification wrong.
 *
 * See `dichromacyGamutError` before trusting a tritan number.
 */
export function simulateDichromacy(hex: string, kind: Dichromacy): string | null {
  const out = collapseLinear(hex, kind)
  if (!out) return null
  const enc = (c: number) => {
    const v = Math.max(0, Math.min(1, c))
    // v is already in [0,1], so 255 * gamma(v) is already in [0,255]: rounding is
    // the only work left, and calling `clamp` here would also read it before its
    // own declaration.
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
  }
  return `#${out.map((c) => enc(c).toString(16).padStart(2, '0')).join('')}`
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const mix = (rgb: Rgb, target: number, t: number): Rgb =>
  rgb.map((c) => clamp(c * (1 - t) + target * t)) as Rgb

/**
 * Derive the `--accent-press` (hover) and `--accent-soft` (faint surface) CSS-var
 * triplets from a single brand color, so overriding only `--accent` doesn't leave
 * those two as the default emerald (a partial re-skin). Theme-aware: the soft tint
 * blends toward white in light mode and toward a dark base in dark mode.
 */
export function deriveAccentVariants(hex: string, isDark: boolean): { press: string; soft: string } | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const press = mix(rgb, 0, 0.18) // ~18% darker
  const soft = isDark ? mix(rgb, 24, 0.8) : mix(rgb, 255, 0.86)
  return { press: press.join(' '), soft: soft.join(' ') }
}
