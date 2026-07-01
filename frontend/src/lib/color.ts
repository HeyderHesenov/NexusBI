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

/** Perceived (sRGB) relative luminance in [0,1]. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
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
