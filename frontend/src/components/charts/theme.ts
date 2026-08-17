import { useThemeStore } from '../../store/themeStore'
import type { GraphHealthStatus, GraphNodeType } from '../../types'

type Mode = 'light' | 'dark'

/**
 * Chart colours, per theme.
 *
 * WHY THESE ARE HEX AND NOT CSS TOKENS. They used to be, in spirit — the file
 * claimed charts "cannot resolve CSS custom properties". That was never quite
 * the reason (SVG `fill` does resolve `rgb(var(--x))`, and PieChartWidget shipped
 * two of them). The real reason is one directory over, in `lib/chartExport.ts`:
 * image export serializes the live <svg> and hands it to the browser as a
 * standalone document. A detached SVG has no :root to resolve `var()` against,
 * so every token-coloured mark loses its colour in the exported PNG. Hex travels;
 * `var()` does not.
 *
 * WHY THEY ARE PER-MODE. Every colour below used to be shared by both themes,
 * and every one of them was tuned on the dark canvas: measured against the light
 * surfaces, 15 of the 20 fell under the 3:1 non-text floor of WCAG 1.4.11
 * (SERIES 4/6, GRAPH_TYPE_COLORS 7/9, HEALTH_COLOR 3/4, DANGER 1/1) while all 20
 * passed on dark.
 *
 * The health three are counted the way the ring paints them: composited at
 * opacity 0.9 over `--surface`, the one canvas it lands on. That is ok 2.99,
 * warn 1.92, danger 2.66 — while `unknown` clears at 3.06. Both other ways of
 * counting are wrong and both have stood in this comment: at raw hex it reads
 * 2/4 (a floor no ring is ever painted at), and over `--surface-2` it reads 4/4
 * (a surface this ring never touches). Quote the backdrop, or the number means
 * nothing.
 *
 * A single shared palette can satisfy both canvases, but only inside
 * `0.162 ≤ relative luminance ≤ 0.268` — a window 0.106 wide, across which the
 * lightest and darkest of six hues can differ by at most 1.50:1. Everything is
 * then within half a stop of everything else, and the set collapses into one
 * tone for anyone who cannot use hue. Splitting by mode gives each canvas the
 * full range instead: the light set below spans 2.67:1 end to end and the dark
 * set 2.93:1, against the 1.50:1 a shared palette is capped at.
 *
 * ⚠️ The gain is in RANGE, and it used NOT to be in neighbour separation — the
 * previous sets sat 1.02–1.46:1 apart between luminance neighbours, no better
 * than the packed alternative, and this paragraph said so rather than claim a win
 * it did not have. The re-pick changed that as a side effect of asserting a
 * greyscale floor: neighbours now sit 1.19–1.26:1 (light) and 1.15–1.44:1 (dark),
 * i.e. evenly spread rather than clumped. That is a consequence of the ΔL* floor
 * below, not an independent property, and it is not what the palette is graded on.
 *
 * Both sets were re-picked against that floor, so neither is what shipped before
 * the split. Each colour was measured against `--bg` / `--surface` /
 * `--surface-2`; the worst case of the three is quoted.
 */

/** Near-black ink that rides on top of every graph node. */
export const GLYPH = '#1B1A18'

/** How many distinct series a chart can show before hues repeat. */
export const SERIES_COUNT = 6

/**
 * Emerald-led categorical palette, spread by LIGHTNESS on purpose.
 *
 * WHO THIS IS SPREAD FOR. Dichromacy does not dull hue, it deletes an axis:
 * deuteranopia and protanopia remove red-green, tritanopia removes blue-yellow.
 * What survives is lightness plus the one axis still standing — so two series
 * that differ only along the missing axis merge completely, however far apart
 * they look to everyone else.
 *
 * ⚠️ NEITHER AXIS CARRIES THIS ALONE, AND THE FILE HAS BEEN WRONG ABOUT THAT IN
 * BOTH DIRECTIONS. An early version claimed a clean rule — "every failing pair had
 * ΔL* under 5 and every passing pair had ΔL* over 12" — which the palette it cited
 * did not show. A later one said lightness "does most of the work", while that same
 * set had a pair at ΔL* 0.4 scoring ΔE00 28.9 under deuteranopia, i.e. carried
 * entirely by surviving hue. (The 43.1 this sentence used to quote was that pair
 * in CIE76, from before the metric changed — it is 41.9 in ΔE00 for normal
 * vision, and the deuteranope's 28.9 is the figure the argument needs.)
 *
 * Measured on the sets below: strip the hue and the worst pair falls to ΔE00 3.62
 * (light) and 3.15 (dark), around a third of the floor. So lightness ALONE never
 * satisfies the 10 ΔE requirement, and the two properties are separate
 * requirements rather than one implying the other — which is exactly why there are
 * now two floors, scored by two different assertions, and why neither can be
 * dropped on the grounds that the other passes.
 *
 * The hues are spread wider than they used to be as a result: light runs 60°, 77°,
 * 131°, 162°, 287°, 318°, where four of the previous six sat green-through-blue.
 * That is a fact about THIS palette, not a general law.
 *
 * That is also why an earlier framing of this ticket — "separate the hues of the
 * two pairs that collide" — was abandoned after measurement. Changing a hue cannot
 * help a reader who has no hue; it is the lightness floor that reaches them, and it
 * had to be asserted separately to exist at all.
 *
 * WHAT IS ASSERTED. `theme.test` scores every pair a chart can actually paint
 * side by side — the six against each other AND against the faint-ink mark, which
 * is the folded-"other" pie wedge and the AXIS line at the same hex — at a 10 ΔE
 * floor in normal vision and under all three dichromacies, at a 4.5 ΔL* floor for
 * monochrome, and every colour against every surface at 3:1. The dichromacy floor
 * is the binding one: the palette two generations back measured 2.2 (dark) and 5.2
 * (light) there while passing everything else, which is exactly how it shipped
 * unnoticed.
 *
 * ⚠️ The light figure was written as 6.5 one paragraph from a test asserting 5.2.
 * 5.2 is right; 6.5 was the protan/deutan minimum with tritanopia dropped, and
 * the same omission is what miscounted the node-colour pairs further down.
 *
 * ✅ AND THE FLOOR IS NOW MET. Two tickets ran through this paragraph and both are
 * closed. The first — adopt CIEDE2000, after fixing the tritan model — moved every
 * number it used to quote: it had said the weakest pairs were light [0]/[2] at 5.37
 * and dark [1]/[2] at 5.34, but those were partly measurements of a silent gamut
 * clamp, since Viénot's single plane threw six of these colours outside the
 * displayable cube under tritanopia and the simulator clipped them without saying
 * so. Measured through Brettel's two half-planes they were light [4]/INK_FAINT at
 * 3.24 and dark [4]/[5] at 3.99, and FOURTEEN pairs sat under the floor.
 *
 * The second ticket was re-picking these colours, which is what the sets below are.
 * The debt is zero in both modes. The floor was never lowered to reach it — 10 is
 * the same digit it was when fourteen pairs failed it, because a floor chosen to
 * fit the numbers it grades has stopped being a requirement. What moved was the
 * palette: worst pair light [2]/[5] at 12.12 under tritanopia — with [3]/[5] and
 * [0]/[1] inside the same tenth of a point, so MARGIN pins all three as the
 * closest SET rather than picking a winner one 8-bit nudge could change — and
 * dark [1]/[5] at 12.01 under deuteranopia, all pinned in `charts/theme.test`.
 *
 * ⚠️ AND THE SIXTH COLOUR IS WHERE IT IS BECAUSE OF THE AXIS LINE, which is worth
 * a paragraph because nothing about #3D3835 or #E1E5F0 looks chosen otherwise.
 * The re-pick above put the six on an even lightness ladder, and the last rung
 * landed on `AXIS` — which is the same hex as INK_FAINT, so the sixth data line
 * measured ΔE00 0.91 from the axis rule it is drawn beside (dark; 1.76 light).
 * The guard could not see it: the scored set excluded the [5]/INK_FAINT pair on
 * the grounds that a folded pie never paints [5], which is true of the PIE and
 * false of the AXIS, and the two are one colour.
 *
 * The fix is expensive and the geometry is why. AXIS has to clear 3:1 as a graphic
 * and stay UNDER 4.5:1 so it is never mistaken for text — two assertions squeezing
 * it into one contrast band, i.e. one lightness band, which is where [5] sat too.
 * A ΔL* ≥ 4.5 separation inside a shared band is not available, so one of them had
 * to leave, and it cannot be the axis. Measured, light's other five occupy
 * L* 29.0–50.9 in steps of 5–6 with the axis at 56.5 — no interior gap fits, and
 * above the axis a colour loses 3:1 against white — so the only room is BELOW,
 * at L* ≤ 24. Dark is the mirror: L* ≈ 78 or L* ≥ 90. The sets below take the
 * far end in both modes, which keeps [5] a neutral in both and costs it ΔE00 30.9
 * (light) and 33.7 (dark) from the colour it replaces. It is now the loudest mark
 * on the canvas rather than the quietest, and that is the price of the separation,
 * not an oversight.
 *
 * AND GREYSCALE IS COVERED TOO, which it never was before. Every dichromacy model
 * PRESERVES lightness, so no simulation in that test can see a pair that differs
 * only in hue; the check this replaced could not either, since a luminance gap
 * between sorted NEIGHBOURS says nothing about the pair two steps apart. The old
 * sets had 4 light pairs and 8 dark colliding in greyscale, worst ΔL* 0.4 — two
 * colours that photocopy to the same grey. The sets below are chosen against an
 * explicit ΔL* floor as well, worst 5.04 (light, three pairs tied) and 5.11
 * (dark [1]/[5]).
 *
 * ⚠️ THE ΔL* FLOOR IS ASSERTED AT 4.5, NOT AT THE 5 THIS TICKET SET OUT TO HOLD,
 * and the half-point is worth the sentence. Measured over the search space as it
 * stood before the axis was added to it: light could reach ΔL* 5.05 while moving
 * no colour more than ΔE00 12.1 from its predecessor, but buying half a point more
 * margin cost a shift of 29.2 — a different palette, not this one adjusted. So 5
 * was reachable and 5.5 was not, at any shift a reader would recognise as the same
 * product. Asserting 5 against a measured 5.05 would be a tripwire rather than a
 * requirement, which is the same "margin 0.2" mistake this repo made once already;
 * asserting 4.5 leaves 0.54 (light) and 0.61 (dark) of real air, and the achieved
 * values are pinned exactly in MARGIN so the gap between "required" and "got" is
 * written down, not hidden.
 *
 * ⚠️ THAT "NO COLOUR MOVES MORE THAN 12.1" NO LONGER DESCRIBES THE SHIPPED SET,
 * and the sentence above is left in the past tense rather than deleted because the
 * floor is still 4.5 for the reason it gives. Adding the axis to the scored set
 * moved [5] by 30.9 and 33.7 — the shift budget that argument was costed against
 * does not survive the paragraph above it.
 *
 * ⚠️ BEFORE ADDING A SEVENTH COLOUR, note that the arithmetic this docblock used
 * to offer for "a seventh does not fit" was wrong twice over. It said six colours
 * want ~50 L* units of room — but six clear the floor inside 27.0 L* (light) and
 * 35.4 (dark), precisely because pairs can also separate on surviving hue, which
 * this same docblock says two paragraphs up. It also counted intervals wrongly
 * elsewhere (nine colours is eight gaps, not nine). The room is genuinely tight —
 * dark leaves 52.8 L* above the 3:1 floor, and a seventh colour now has to clear
 * the ΔL* floor too, which is the constraint that actually binds — but "does not
 * fit" was asserted, not shown. A seventh needs measuring, not a rule of thumb.
 *
 * `[0]` is the `--accent` token exactly, in BOTH modes. It was only ever true
 * of light: dark shipped #0E9F6E against an --accent of #10B981, so the comment
 * that claimed it was half wrong. Freezing [0] to the token here is what makes
 * the sentence true and closes the last chart/app colour divergence.
 */
// Ratios are worst-of-three background contrast, as everywhere else in this file.
// Both sets were chosen by minimising the LARGEST move from the palette they
// replace, subject to every floor above — not by maximising separation, which
// pushes an optimiser to the ends of the lightness axis where hue stops meaning
// anything and returns a set no one would recognise as this product.
//
// [5] is the exception, and it is not one the objective was free to make: adding
// the axis to the scored set left it no interior room at all, so the same
// "smallest move" search returned a colour at the far end of the lightness axis
// in both modes. Where the search offered a family — dark also allows a gold at
// L* 78 — the neutral was taken, because [5] is the palette's quiet slot in light
// mode too and a second ochre beside [3] would cost the set a hue family.
//
// The search enforced 12 ΔE00 and 5.0 ΔL* rather than the 10 and 4.5 the tests
// assert. Shipping a colour that clears a floor by 0.04 makes the guard a
// tripwire; the air is deliberate and MARGIN records what it bought.
const SERIES_LIGHT = [
  '#0A6E4C', // emerald (accent)    5.69  — frozen: this IS the --accent token
  '#5C8444', // moss green          3.94  — the tightest of the six
  '#4C5068', // slate blue          7.18
  '#58401C', // umber               8.80
  '#9450B0', // violet              4.72
  '#3D3835', // near-black neutral 10.50  — parked below the axis; see AXIS, below
]

const SERIES_DARK = [
  '#10B981', // emerald (accent)    5.87  — frozen: this IS the --accent token
  '#90E8C4', // mint               10.29
  '#A8B4CC', // pale slate          7.13
  '#BC8C28', // ochre               4.90
  '#8080B8', // periwinkle          4.04  — the tightest of the six
  '#E1E5F0', // near-white neutral 11.81  — parked above the axis; see AXIS, below
]

/**
 * Danger/negative for GRAPHICS ONLY — strokes, fills, backgrounds.
 *
 * Never as text: `theme.contrast.test` fails the build if it lands behind a
 * `style` colour or an SVG text `fill`. Text takes `rgb(var(--danger))` or the
 * `text-danger` class.
 *
 * ✅ THE DIVERGENCE THIS FILE USED TO DOCUMENT IS CLOSED. Both values are now
 * the app's own `--danger` token — dark always was (216 124 107), and light can
 * be now that it no longer has to double as a dark-canvas colour. A chart no
 * longer draws its bar in one red while the label describing it renders another.
 */
const DANGER_LIGHT = '#AB4A37' // = --danger 171 74 55   · 5.06 as a graphic
const DANGER_DARK = '#D87C6B' // = --danger 216 124 107 · 4.97

/** Accent, matching `--accent` in both modes for the same reason as DANGER. */
const ACCENT_LIGHT = '#0A6E4C' // = --accent 10 110 76 · 5.69
const ACCENT_DARK = '#10B981' // = --accent 16 185 129 · 5.87

/**
 * Trust-overlay ring colour per health severity. Extracted (not inline) so the
 * mapping is unit-testable. `ok` never renders a ring (see ForceGraph), but is
 * included so the record is exhaustive.
 *
 * Scored on the COMPOSITE, not the hex: the ring is drawn at `opacity 0.9`, so
 * the number that matters is what 90% of the colour over `--surface` comes to.
 * The light ratios below are that composite.
 *
 * `--surface` alone, and not the worst of the three surfaces the palette above
 * is quoted against, because this ring is not free to land anywhere: it is only
 * ever drawn on the graph canvas, which is `bg-surface` (ForceGraph) and exports
 * on `theme.SURFACE`. The others still clear the floor there anyway — `unknown`,
 * the tightest, holds 3.24 on `--surface-2` — so the narrower scope is a
 * statement about where the mark lives, not a softer bar.
 */
const HEALTH_LIGHT: Record<GraphHealthStatus, string> = {
  ok: ACCENT_LIGHT, // 5.11
  warn: '#6F5E24', // 5.04
  danger: DANGER_LIGHT, // 4.62
  unknown: '#807B72', // 3.52
}

/**
 * Opacity the trust ring is painted at, and therefore the opacity its contrast
 * is scored at.
 *
 * Exported and imported by ForceGraph rather than written down in both places:
 * the ratios above are only true at this number, so a component free to pick its
 * own would invalidate them silently. The guard that used to grep ForceGraph for
 * the literal is still there, but it is now a second line of defence rather than
 * the only thing joining the two.
 */
export const RING_OPACITY = 0.9

/**
 * Stroke width the trust ring is painted at, and the narrower width it uses when
 * the node is dimmed (hover-neighbour or impact-mode de-emphasis).
 *
 * ⚠️ THE DIMMED STATE USED TO BE AN OPACITY, AND NO OPACITY WORKS. The ring
 * dropped to `opacity 0.4` there, which composites to 1.63–2.40 over `--surface`
 * — under the 3:1 of WCAG 1.4.11, on a mark whose whole job is to say "this node
 * has a problem". Nor is there a gentler number to retreat to: measured across
 * both modes and all three ring colours, 0.5 reaches 1.87, 0.7 reaches 2.53 and
 * 0.8 still only reaches 2.97, with light `unknown` binding every time. 0.9 is
 * the first value that clears, i.e. the only one available is the undimmed one.
 *
 * So opacity is simply the wrong lever for a mark that has to stay legible, and
 * WIDTH is the right one: 1.4.11 scores the colour relationship, not the size, so
 * a thinner ring recedes without moving the ratio. The de-emphasis is still
 * plainly there — the node under it drops to 0.2 and its edges to 0.28, so a thin
 * ring reads as belonging to a backgrounded node rather than competing with the
 * selection.
 *
 * ⚠️ "WITHOUT MOVING THE RATIO" HAS ONE LIMIT, and this used to say "at all",
 * which was wrong. It holds while the stroke is at least a pixel wide; below that
 * the rasteriser composites it at its pixel coverage, and partial coverage IS an
 * opacity — the ring would arrive back under 3:1 by the very route it left. These
 * are USER units, so an unscaled 1.5 fell to ~0.66 CSS px at MIN_ZOOM. ForceGraph
 * therefore counter-scales both this and the dash by `tipScale`, which makes these
 * numbers CSS pixels at fit rather than user units, and the on-screen width
 * independent of zoom.
 */
export const RING_WIDTH = 2.5
export const RING_WIDTH_DIM = 1.5

/**
 * `stroke-dasharray` per health severity — the ring's SECOND, colour-free
 * channel. Solid means worse.
 *
 * WHY IT EXISTS. The ring's PRESENCE already carries "not ok" without colour
 * (`ok` is never ringed). Which severity was hue and nothing else, and hue is
 * exactly what the affected reader does not have: composited at RING_OPACITY over
 * `--surface`, `warn` vs `danger` measures ΔE00 4.50 under deuteranopia in light
 * mode and 9.39 under deuteranopia in dark, against a 10 floor. (The pre-Brettel
 * figures were 4.81 and "5.74 under tritanopia"; the condition changed with the
 * model, the conclusion did not.) Deuteranopia is
 * ~6% of men — an earlier note filed this ticket as "tritanopia only, ~0.01%",
 * which understated who it hits by roughly three orders of magnitude.
 *
 * ⚠️ A DASH ALONE WOULD NOT HAVE CLOSED IT, and neither would a tooltip alone.
 * A tooltip needs one hover per node, so it does nothing for the case the defect
 * actually lives in — sweeping the canvas — and help routed through assistive
 * tech is aimed at the wrong person anyway: the reader losing this signal is
 * sighted. But a dash on its own is an unlabelled code; solid-versus-dashed shows
 * two marks are different without saying which is worse. The tooltip severity
 * word (ForceGraph) is what teaches the code, so the two ship together.
 *
 * `unknown` gets its own pattern even though colour already separates it from
 * both others, because the margin it does that by is thin: `danger`/`unknown`
 * measures 10.88 under protanopia in dark mode, a pass by 0.88.
 *
 * ⚠️ THE CODE IS AN ORDER, NOT THREE LABELS, and the order is the part worth
 * guarding. `solid > dashed > dotted` is a ranking of how much the stroke is
 * interrupted, and it has to run the same way as severity or the mark lies:
 * swapping `warn` and `danger` leaves three still-distinct patterns, so a guard
 * that only asks for distinctness stays green while the canvas calls the calmer
 * node the more urgent one. `inkFraction` below turns each pattern into the
 * number that ordering is stated in, so the test can assert the ranking instead
 * of the spelling — measured, that is danger 1, warn 6/11, unknown 0.
 *
 * `ok` is deliberately NOT a key. It used to be one, holding `undefined` — the
 * same value `danger` holds for "solid" — so the record could not distinguish
 * "draws no ring" from "draws an unbroken one", and swapping those two was a
 * no-op no test could ever catch. Excluding it makes the ringed set derivable
 * from this record (`RINGED_STATUSES`) instead of hand-copied into two suites.
 */
export const RING_DASH: Record<RingedStatus, string | undefined> = {
  danger: undefined, // solid — uninterrupted reads as the most urgent
  warn: '6 5', // dashed
  unknown: '0 5', // dotted (round linecap turns a zero-length dash into a dot)
}

/** The severities that paint a ring. `ok` never does — hence its absence above. */
export type RingedStatus = Exclude<GraphHealthStatus, 'ok'>
export const RINGED_STATUSES = Object.keys(RING_DASH) as RingedStatus[]

/**
 * Share of the ring's circumference that is inked, for one `stroke-dasharray`.
 * Solid is 1, `'0 5'` is 0, and `'6 5'` is 6/11 — i.e. exactly the axis the dash
 * code ranks severities along, which is why the guard can state the invariant as
 * an ordering rather than as today's three literals.
 *
 * ⚠️ Ignores `stroke-linecap`, which is correct HERE and wrong as a general
 * measure of painted ink: a round cap extends every dash by half the stroke
 * width at each end, which is what turns `'0 5'` into dots at all. This function
 * scores the PATTERN, the thing severity is encoded in; ForceGraph is where the
 * cap is chosen, and it only puts one on `unknown` for that reason.
 */
export function inkFraction(dash: string | undefined): number {
  if (dash === undefined) return 1
  const parts = dash.trim().split(/[\s,]+/).map(Number)
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`inkFraction() got a malformed dasharray: ${dash}`)
  }
  // An odd-length list repeats to become even (SVG 1.1 §11.4), so `'4'` is 4-on
  // 4-off, not 4-on 0-off.
  const cycle = parts.length % 2 ? [...parts, ...parts] : parts
  const total = cycle.reduce((a, b) => a + b, 0)
  if (total === 0) throw new Error(`inkFraction() got an all-zero dasharray: ${dash}`)
  return cycle.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / total
}

const HEALTH_DARK: Record<GraphHealthStatus, string> = {
  ok: ACCENT_DARK, // 5.58 composited — the light side has said `ok: ACCENT_LIGHT`
  //                  all along, and this was the hardcoded twin that made
  //                  "closes the LAST chart/app colour divergence" untrue.
  warn: '#CBB25E', // 6.71
  danger: DANGER_DARK, // 4.78
  unknown: '#8C877E', // 4.02
}

/**
 * Knowledge-graph node colours — one distinct, mid-tone hue per asset type so no
 * two types collide (the 6-colour SERIES forced widget/squery and dash/decision
 * to share).
 *
 * ⚠️ "No two collide" holds in normal vision only, and unlike SERIES that is
 * ACCEPTED here rather than fixed. Scored against the same 10 ΔE floor, **11 of
 * the 36 light pairs and 6 of the 36 dark** fall under it beneath some
 * dichromacy — worst `metric`/`squery` at ΔE 1.0 under tritanopia, which is one
 * colour, not two.
 *
 * (Those counts read 14 and 9 for one commit. That was pairs-times-conditions out
 * of 108 reported as pairs out of 36 — the measuring script pushed one row per
 * failing (pair, condition) and the number was quoted without re-reading what it
 * had counted. Same class as the 6.5 above: a figure carried out of the tool that
 * produced it and into a sentence that means something else.)
 *
 * It is accepted because hue is not the channel carrying type here. Every node
 * draws a per-type icon on top (`TYPE_ICON` in ForceGraph — nine types, nine
 * symbols), and the legend, the detail sidebar and the asset picker each pair
 * the swatch with that icon AND the type's name in words. SERIES has no such
 * second channel — nothing but the colour tells one line from another — which is
 * why it was re-picked and this was not.
 *
 * ⚠️ The mini-map is the one colour-only site, and `aria-hidden` is NOT the
 * reason it is tolerable — that was a bad argument, written here for one commit.
 * Removing a node from the accessibility tree helps a screen-reader user; it does
 * nothing for the sighted dichromat this whole floor exists for, who sees the
 * mini-map perfectly well and cannot separate its dots. What actually carries the
 * argument is the other half: the mini-map is a viewport-navigation aid, every
 * node in it is reachable and identifiable in the canvas it mirrors, and nothing
 * is read from it. (It is also an interactive surface — onPointerDown /
 * onPointerMove — hidden from assistive tech, which is its own small ticket.)
 *
 * These answer to TWO floors, not one: 3:1 against the canvas AND 3:1 against
 * the GLYPH sitting on top of them. The glyph is what stops the light set from
 * simply reusing `--accent` for `ds` the way SERIES[0] does — the token is dark
 * enough that a near-black glyph on it measures 2.77, so `ds` is a slightly
 * lighter emerald here. Two constraints pulling opposite ways is exactly the
 * kind of thing a single "make it darker" pass gets wrong silently.
 *
 * Quoted worst-of-three like the rest of the palette, NOT canvas-only: unlike
 * the health ring, these are not confined to the graph. The same colour is a
 * legend chip and a panel header on `--surface-2` (GraphCanvas) and a row marker
 * in the asset picker. An earlier revision quoted the `--surface` figures here
 * while the header two screens up promised worst-of-three; `column` was the tell,
 * reading 3.44 there and 3.12 in fact.
 */
const GRAPH_LIGHT: Record<GraphNodeType, string> = {
  //                    canvas · glyph
  ds: '#0B8159', //       4.43 · 3.56  emerald — data source (root)
  table: '#547EB2', //    3.81 · 4.14  dusty blue
  metric: '#9D8433', //   3.30 · 4.79  gold
  mnode: '#8D68AD', //    4.04 · 3.91  mauve
  dash: '#C06E20', //     3.47 · 4.55  amber
  widget: '#3E8A83', //   3.69 · 4.28  teal
  squery: '#B95B83', //   3.90 · 4.05  rose
  decision: '#5F6DB1', // 4.42 · 3.57  indigo
  column: '#6E8DB0', //   3.12 · 5.05  muted slate — the tightest of the nine
}

const GRAPH_DARK: Record<GraphNodeType, string> = {
  ds: '#0E9F6E',
  table: '#7C9CC4',
  metric: '#CBB25E',
  mnode: '#A88BC0',
  dash: '#E39A55',
  widget: '#4FAFA6',
  squery: '#CE8CA8',
  decision: '#6E7BB8',
  column: '#A9BBD0',
}

export interface ChartTheme {
  SERIES: string[]
  /**
   * Axis rules, tick marks and reference lines.
   *
   * ⚠️ THE SAME HEX AS `INK_FAINT`, in both modes, and `theme.test` pins that
   * equality rather than leaving it to coincidence. It matters because the two are
   * scored as ONE mark: a chart that draws this rule beside a data line is putting
   * the faint ink next to every series, so all six have to stay clear of it. That
   * was missed once — the scored set skipped SERIES[5] against the faint mark
   * because a folded pie never paints SERIES[5], which is true of the pie and says
   * nothing about the axis. If these two ever diverge, the pin fails and the marks
   * have to be split rather than the pin relaxed.
   */
  AXIS: string
  GRID: string
  ACCENT: string
  /** Danger/negative — graphics only. See DANGER_LIGHT. */
  DANGER: string
  /** Ring colour per health severity. */
  HEALTH_COLOR: Record<GraphHealthStatus, string>
  /** Node fill per asset type. */
  GRAPH_TYPE_COLORS: Record<GraphNodeType, string>
  /** Surface color — node separator ring + label halo on the graph canvas. */
  SURFACE: string
  /** Secondary ink — readable node labels. */
  INK_SOFT: string
  /** Faint ink — the folded "other" wedge, the axis rule (see AXIS), and anything
   * else deliberately quiet. */
  INK_FAINT: string
  /** Graph edge stroke — stronger than GRID so directional links read. */
  EDGE: string
  tooltipStyle: Record<string, unknown>
  tooltipItem: Record<string, unknown>
  tooltipLabel: Record<string, unknown>
}

const THEMES: Record<Mode, ChartTheme> = {
  light: {
    SERIES: SERIES_LIGHT,
    AXIS: '#8C877E',
    GRID: '#E5E3DC',
    ACCENT: ACCENT_LIGHT,
    DANGER: DANGER_LIGHT,
    HEALTH_COLOR: HEALTH_LIGHT,
    GRAPH_TYPE_COLORS: GRAPH_LIGHT,
    SURFACE: '#FFFFFF',
    INK_SOFT: '#5B5750',
    INK_FAINT: '#8C877E',
    EDGE: '#CBC6BC',
    tooltipStyle: {
      background: '#FFFFFF',
      border: '1px solid #E5E3DC',
      borderRadius: 10,
      fontSize: 12,
      color: '#1F1E1D',
      boxShadow: '0 8px 24px -12px rgba(60,50,40,0.25)',
    },
    tooltipItem: { color: '#1F1E1D' },
    tooltipLabel: { color: '#5B5750' },
  },
  dark: {
    SERIES: SERIES_DARK,
    AXIS: '#7C766E',
    GRID: '#3A3733',
    ACCENT: ACCENT_DARK,
    DANGER: DANGER_DARK,
    HEALTH_COLOR: HEALTH_DARK,
    GRAPH_TYPE_COLORS: GRAPH_DARK,
    SURFACE: '#1F1E1D',
    INK_SOFT: '#A8A39B',
    INK_FAINT: '#7C766E',
    EDGE: '#4A463F',
    tooltipStyle: {
      background: '#1F1E1D',
      border: '1px solid #3A3733',
      borderRadius: 10,
      fontSize: 12,
      color: '#EDEAE6',
      boxShadow: '0 8px 24px -10px rgba(0,0,0,0.6)',
    },
    tooltipItem: { color: '#EDEAE6' },
    tooltipLabel: { color: '#A8A39B' },
  },
}

/** Asset types in declaration order — for legends that list every type. */
export const GRAPH_TYPES = Object.keys(GRAPH_DARK) as GraphNodeType[]

export function chartTheme(mode: Mode): ChartTheme {
  return THEMES[mode]
}

/** Theme-aware chart palette; re-renders the chart when the user toggles theme. */
export function useChartTheme(): ChartTheme {
  return chartTheme(useThemeStore((s) => s.mode))
}
