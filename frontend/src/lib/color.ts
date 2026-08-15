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
 * `fg` painted at `alpha` over `bg`, as the browser composites it. Throws on a
 * malformed hex rather than returning a colour nobody asked for.
 *
 * Scoring a raw hex when the product paints it at an opacity scores a colour
 * that never reaches the screen — the lesson the axis rules taught, where
 * `stroke={AXIS} opacity={0.6}` composited to 1.90 while a test on the token
 * itself read 3.24 and stayed green.
 *
 * ⚠️ EXPORTED FROM HERE, not redefined per test file, for the reason
 * `srgbToLinear` spells out above: this file has already been the scene of one
 * curve growing three copies. `charts/theme.test` scores the ring colours and
 * `graph/ForceGraph.test` scores the ring as actually rendered — two callers, one
 * formula. Like `simulateDichromacy` it has no production caller and is
 * tree-shaken out of `dist/`.
 */
export function composite(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg)
  const b = hexToRgb(bg)
  if (!f || !b) throw new Error(`composite() got a malformed hex: ${fg} over ${bg}`)
  // ⚠️ ALPHA IS CHECKED, and the reason is that the promise in the docstring was
  // not being kept. The combination is convex only while alpha is in [0,1]:
  // outside it the result leaves 0-255 and the hex formatting produces garbage
  // silently — 1.2 over white gives '#-33-33-33', and a NaN alpha gives
  // '#NaNNaNNaN'. Neither is hypothetical; the ForceGraph guard feeds this an
  // alpha read out of the DOM, where an ancestor `opacity: inherit` or a
  // percentage is one `Number()` away from NaN.
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`composite() got an out-of-range alpha: ${alpha}`)
  }
  // `clamp` is used rather than a bare `Math.round`. An earlier note here claimed
  // reaching it would cross its TDZ — that was simply wrong: this is a function
  // DECLARATION, its body runs when called, long after module evaluation has
  // passed the `const`. Nothing was preventing the reuse, and the missed reuse is
  // what left the range unguarded above.
  const out = f.map((c, i) => clamp(alpha * c + (1 - alpha) * b[i]))
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`
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

const DEG = Math.PI / 180
/** atan2 in degrees, folded to [0,360). */
const hueDeg = (b: number, a: number) => {
  if (a === 0 && b === 0) return 0 // undefined hue; the formula's own convention
  const h = Math.atan2(b, a) / DEG
  return h < 0 ? h + 360 : h
}

/**
 * CIEDE2000 (ΔE00) between two hex colours — the repo's ONE perceptual distance.
 * **NaN** if either hex is malformed.
 *
 * ⚠️ NaN, NOT 0, and the reason outlived the CIE76 function that first learned
 * it. That one returned 0 on the rationale "callers assert a FLOOR, so a
 * malformed hex fails loudly rather than passing" — and the same commit wrote an
 * assertion in the other direction (`toBeLessThan(SEPARATION)`, the confusion-line
 * collapse anchor), where 0 passes silently and makes the anchor vacuous. NaN is
 * the only value that fails BOTH a floor and a ceiling, so the guarantee does not
 * depend on every future caller choosing one direction.
 *
 * WHY CIE76 IS GONE RATHER THAN KEPT ALONGSIDE. It was plain Euclidean distance
 * in a space that is not actually uniform, and on this repo's own palette it did
 * not agree with CIEDE2000 about WHICH pair is weakest — measured after the
 * tritan model was fixed, CIE76 ranks light S0/S2 at 7.50 and puts S4/INK_FAINT
 * at 2.87, while ΔE00 reverses them (5.19 and 3.24). Keeping both would leave a
 * weaker metric one import away for the next caller, and would leave CIE76 itself
 * anchored only by its own two assertions — the shape of guard this repo has been
 * caught by before. Both of those anchors moved here intact: black-to-white is
 * still exactly 100 (Sl = 1 at L̄ = 50), and equal sRGB steps still rank
 * unequally, 1.35× rather than CIE76's 1.33×.
 *
 * Rough reading: ~1 is a just-noticeable difference on a large flat patch, ~10 is
 * the floor `charts/theme.test` asks two chart marks to clear.
 *
 * ⚠️ IMPLEMENTATION NOTES THAT ARE EASY TO GET WRONG, all of them Sharma's:
 * - `R_T` belongs INSIDE the square root, as a cross term. An earlier throwaway
 *   implementation in this repo put it outside and produced NEGATIVE distances.
 * - The mean hue `hbar` has three branches, and the `C'1·C'2 == 0` branch is not
 *   an average at all — it is the sum, because one hue is undefined.
 * - Hue difference folds to (-180,180], and `ΔH'` uses `sin(Δh/2)`, not `Δh`.
 * - `a` is rescaled by `1+G` BEFORE chroma and hue are computed, so `C'` and `h'`
 *   are not the plain CIELAB chroma and hue.
 * None of that is asserted by eye: `color.test` runs Sharma, Wu & Dalal's 34
 * published pairs, which exist precisely because each one breaks a different
 * plausible mistake.
 */
export function deltaE2000(hexA: string, hexB: string): number {
  const ra = hexToRgb(hexA)
  const rb = hexToRgb(hexB)
  if (!ra || !rb) return NaN
  return labDeltaE2000(toLab(ra), toLab(rb))
}

/** The formula itself, on CIELAB triples — separated so the published test data can drive it. */
export function labDeltaE2000(
  [L1, a1, b1]: [number, number, number],
  [L2, a2, b2]: [number, number, number],
): number {
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cbar = (C1 + C2) / 2
  const c7 = Cbar ** 7
  const G = 0.5 * (1 - Math.sqrt(c7 / (c7 + 25 ** 7)))

  const A1 = (1 + G) * a1
  const A2 = (1 + G) * a2
  const Cp1 = Math.hypot(A1, b1)
  const Cp2 = Math.hypot(A2, b2)
  const h1 = hueDeg(b1, A1)
  const h2 = hueDeg(b2, A2)

  const dL = L2 - L1
  const dC = Cp2 - Cp1
  // Both branches matter: with either chroma at zero the hue difference is not
  // just small, it is undefined, and treating it as 0 is the defined behaviour.
  let dh = 0
  if (Cp1 * Cp2 !== 0) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * DEG)

  const Lbar = (L1 + L2) / 2
  const Cbarp = (Cp1 + Cp2) / 2
  let hbar: number
  if (Cp1 * Cp2 === 0) hbar = h1 + h2 // NOT a mean — one of them is undefined
  else if (Math.abs(h1 - h2) <= 180) hbar = (h1 + h2) / 2
  else if (h1 + h2 < 360) hbar = (h1 + h2 + 360) / 2
  else hbar = (h1 + h2 - 360) / 2

  const T =
    1 -
    0.17 * Math.cos((hbar - 30) * DEG) +
    0.24 * Math.cos(2 * hbar * DEG) +
    0.32 * Math.cos((3 * hbar + 6) * DEG) -
    0.2 * Math.cos((4 * hbar - 63) * DEG)

  const dTheta = 30 * Math.exp(-(((hbar - 275) / 25) ** 2))
  const cb7 = Cbarp ** 7
  const Rc = 2 * Math.sqrt(cb7 / (cb7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2)
  const Sc = 1 + 0.045 * Cbarp
  const Sh = 1 + 0.015 * Cbarp * T
  const Rt = -Math.sin(2 * dTheta * DEG) * Rc

  const l = dL / Sl
  const c = dC / Sc
  const h = dH / Sh
  // Rt is a CROSS TERM under the root. Outside it, distances go negative.
  return Math.sqrt(l * l + c * c + h * h + Rt * c * h)
}

export type Dichromacy = 'protan' | 'deutan' | 'tritan'

/**
 * Brettel, Viénot & Mollon (1997): the dichromat's gamut is TWO half-planes
 * hinged along the neutral axis, not one plane, and a colour is projected onto
 * whichever half it falls on.
 *
 * ⚠️ THIS REPLACED VIÉNOT 1999, WHICH WAS THE WRONG MODEL FOR ONE OF THE THREE.
 * The 1999 paper collapses both halves into a single plane; its own text limits
 * that simplification to protanopia and deuteranopia, where the two halves are
 * nearly coplanar. For tritanopia they are not, and the cost was measurable in
 * this repo: the single plane threw colours far outside the displayable cube,
 * `simulateDichromacy` clamped them silently, and every tritan ΔE was partly a
 * measurement of the clamp. Measured over all three palettes with the old model,
 * protan and deutan clipped NOTHING in either mode, while tritan clipped 2/6,
 * 4/6, 2/4, 3/4, 3/9 and 5/9 of them — worst error 1.314, i.e. more than the
 * entire linear range outside the cube.
 *
 * Both halves are applied here as a single matrix on LINEAR RGB, which is
 * algebraically the same journey the 1999 code took the long way (linear RGB →
 * LMS → collapse → linear RGB) with the three matrices pre-multiplied. The LMS
 * basis behind them is Smith & Pokorny (1975) — the SAME fundamentals the old
 * `RGB_TO_LMS` used, so this is a change of model, not a change of colour space.
 *
 * Constants from libDaltonLens (public domain), which precomputes the products
 * for sRGB primaries. ⚠️ THEY ARE USED ONLY BECAUSE THEY ARE CHECKED, which is
 * why this table is exported at all: `color.test` asserts FOUR structural
 * properties, none of which retypes a constant —
 *
 * 1. every row of both matrices sums to 1, and the plane normal is perpendicular
 *    to [1,1,1] — together, a grey has no hue to lose and must come back
 *    unchanged from either half;
 * 2. P·P = P — a dichromat's view of a dichromat's view is the same view, i.e.
 *    these really are projections and not merely plausible 3×3s;
 * 3. the two matrices AGREE on the boundary plane — the hinge must not be a cliff;
 * 4. and `collapseLinear` actually PICKS between them by the documented sign,
 *    with both branches materially different where it does.
 *
 * A single mistyped digit breaks 1-3 (they hold to ~1e-5, the precision the
 * constants are published at). Property 4 is separate because 1-3 are all
 * satisfied by a model that silently always takes `m1` — which is precisely the
 * Viénot 1999 collapse this replaced, so the property that names the change has
 * to be asserted on its own. It is not hypothetical for this palette either:
 * measured over the 14 chart colours, protan splits them 10/4 across the hinge,
 * deutan 4/10 and tritan 8/6, so the second half-plane is load-bearing in every
 * condition rather than a boundary curiosity.
 */
export const BRETTEL: Record<Dichromacy, { m1: number[]; m2: number[]; normal: number[] }> = {
  protan: {
    m1: [0.1498, 1.19548, -0.34528, 0.10764, 0.84864, 0.04372, 0.00384, -0.0054, 1.00156],
    m2: [0.1457, 1.16172, -0.30742, 0.10816, 0.85291, 0.03892, 0.00386, -0.00524, 1.00139],
    normal: [0.00048, 0.00393, -0.00441],
  },
  deutan: {
    m1: [0.36477, 0.86381, -0.22858, 0.26294, 0.64245, 0.09462, -0.02006, 0.02728, 0.99278],
    m2: [0.37298, 0.88166, -0.25464, 0.25954, 0.63506, 0.1054, -0.0198, 0.02784, 0.99196],
    normal: [-0.00281, -0.00611, 0.00892],
  },
  tritan: {
    m1: [1.01277, 0.13548, -0.14826, -0.01243, 0.86812, 0.14431, 0.07589, 0.805, 0.11911],
    m2: [0.93678, 0.18979, -0.12657, 0.06154, 0.81526, 0.1232, -0.37562, 1.12767, 0.24796],
    normal: [0.03901, -0.02788, -0.01113],
  },
}

/**
 * Linear-light RGB after the projection, BEFORE gamut clipping. Null if malformed.
 *
 * Exported for the tests that have to reach the unclipped value: `simulateDichromacy`
 * clips, so anything asserted about the MODEL has to be asserted here.
 */
export function collapseLinear(hex: string, kind: Dichromacy): number[] | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const lin = rgb.map(srgbToLinear)
  const { m1, m2, normal } = BRETTEL[kind]
  // Which half-plane the colour falls on. The boundary is the plane through the
  // neutral axis, so this sign is the whole difference from the 1999 model —
  // which always took `m1`, wherever the colour was.
  const m = normal[0] * lin[0] + normal[1] * lin[1] + normal[2] * lin[2] >= 0 ? m1 : m2
  return [0, 1, 2].map((r) => m[r * 3] * lin[0] + m[r * 3 + 1] * lin[1] + m[r * 3 + 2] * lin[2])
}

/**
 * How far outside [0,1] the collapse threw `hex`, in linear units; 0 when the
 * simulated colour is representable. NaN if malformed.
 *
 * ⚠️ THIS IS NOT A CURIOSITY. `simulateDichromacy` clamps out-of-gamut output
 * silently, so for a colour that clips, the returned hex is not what the model
 * says — it is the nearest colour a screen can show, and any ΔE measured from it
 * is measuring the clamp as much as the condition.
 *
 * Under the 1999 single plane that was the tritan column's normal state: four of
 * the six dark SERIES clipped, worst error 0.773. Under Brettel it is ZERO, for
 * all 33 colours × 3 conditions × 2 modes — which is why every tritan figure this
 * repo quoted before the model changed was partly a measurement of the clamp, and
 * why they were all re-measured rather than carried forward.
 *
 * ⚠️ "Zero" is a fact about THIS PALETTE, not about the function, and
 * `charts/theme.test` pins it with a positive control for exactly that reason: a
 * quarter of the sRGB cube still clips somewhere (measured on a 16³ grid,
 * 3060/12288), `#FFFF00` and `#00FFFF` among them. Without it, `expect(clipped)
 * .toEqual({})` would stay green if this function were stubbed to return 0.
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
 * apart and score ΔE00 28.9 here. An earlier version of this comment claimed
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
    // the only work left. (An earlier note added "and `clamp` would be read
    // before its declaration" — untrue for the same reason it was untrue in
    // `composite`: this body runs at call time. The rounding argument stands on
    // its own; the TDZ one never did.)
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
