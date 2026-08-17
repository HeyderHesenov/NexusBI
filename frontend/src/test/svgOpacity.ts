/**
 * Opacity as the screen actually composites it, for one paint channel.
 *
 * ⚠️ THE FIRST VERSION OF THIS READ `ring.getAttribute('opacity')` AND WAS WRONG.
 * The node's wrapper <g> carried `opacity={dimmed ? 0.2 : 1}`, so a ring declaring
 * 0.9 painted at 0.18 — worse than the 0.4 that ticket set out to fix — while the
 * test read 0.9, composited from it, and reported a comfortable 4.60:1. Rendering
 * instead of grepping the source was not enough on its own; the quantity has to be
 * the one the eye receives, and a screenshot of the real app is what exposed the gap.
 *
 * ⚠️ AND WALKING THE ANCESTORS FOR `opacity` WAS STILL NOT ENOUGH — TWICE. The
 * second version read only the `opacity` presentation ATTRIBUTE, so the identical
 * defect came back verbatim when spelled `style={{ opacity: … }}`: measured, all
 * 759 tests stayed green while the ring painted at 0.18 again. The third read
 * `stroke-opacity` on the MARK ONLY, so `<g stroke-opacity="0.2">` over a bare
 * <path> measured 1 — verified in this repo's jsdom — and `fill-opacity` was not
 * read at all, in a helper whose own suite exists because a recharts `Area`
 * multiplied a fill opacity nobody had noticed.
 *
 * ⚠️ THE TWO CHANNELS COMPOSE DIFFERENTLY, WHICH IS WHY THIS IS NOT ONE PRODUCT.
 * `opacity` is NOT inherited: it applies to a group as a unit, so every ancestor's
 * value multiplies. `stroke-opacity` and `fill-opacity` ARE inherited properties,
 * so the NEAREST declared value wins outright and ancestors above it contribute
 * nothing — multiplying them, which is the obvious-looking fix, would report 0.25
 * for a <path stroke-opacity="0.5"> inside a <g stroke-opacity="0.5"> where the
 * browser paints 0.5.
 *
 * ⚠️ WHAT THIS STILL CANNOT SEE, STATED RATHER THAN IMPLIED. It reads two sources:
 * the inline `style` and the presentation ATTRIBUTE. A value arriving from a CSS
 * RULE — a stylesheet, or a Tailwind `opacity-40` utility, both of which this repo
 * uses elsewhere — reaches neither, and jsdom will not resolve the utility either,
 * so no amount of `getComputedStyle` would recover it here. The list above is a
 * list of misses, so leaving a fourth one unnamed inside it would read as
 * completeness. Instead of returning 1 for a mark that a class fades, the walk
 * below THROWS when it meets an unconditional `opacity-*` class: the callers state
 * their conclusions as inequalities, which a reader returning 1 always satisfies,
 * so a loud failure is the only form that cannot be mistaken for a pass. Variant
 * utilities (`hover:`, `disabled:`) are left alone — they are conditional, and the
 * condition is not this function's to evaluate.
 *
 * Shared rather than copied: two suites now measure painted marks — the trust ring
 * and the chart palette — and a second hand-written copy is how the versions above
 * came to disagree about what "opacity" meant in the first place.
 */
type Channel = 'stroke' | 'fill'

/** One element's declared value for a property, style first, `null` if absent. */
const declared = (n: Element, prop: 'opacity' | 'strokeOpacity' | 'fillOpacity'): number | null => {
  const attr = { opacity: 'opacity', strokeOpacity: 'stroke-opacity', fillOpacity: 'fill-opacity' }[prop]
  const inline = (n as SVGElement).style?.[prop]
  const raw = inline !== undefined && inline !== '' ? inline : n.getAttribute(attr)
  if (raw === null || raw === undefined || raw === '') return null
  // A percentage is legal SVG and `Number()` returns NaN for it — surface that as
  // a failure rather than letting NaN silently poison the product.
  const v = raw.trim().endsWith('%') ? Number(raw.trim().slice(0, -1)) / 100 : Number(raw)
  if (!Number.isFinite(v)) throw new Error(`unreadable ${attr} on <${n.tagName}>: "${raw}"`)
  return v
}

/** `declared`, defaulting to fully opaque — the value `opacity` takes when unset. */
export const levelOpacity = (n: Element, prop: 'opacity' | 'strokeOpacity' | 'fillOpacity'): number =>
  declared(n, prop) ?? 1

/**
 * What the given channel of `el` is painted at: the inherited channel opacity —
 * nearest declaration wins, searched from the element upward — times the product
 * of every `opacity` on the element and its ancestors.
 */
export const effectiveOpacity = (el: Element, channel: Channel = 'stroke'): number => {
  const prop = channel === 'stroke' ? 'strokeOpacity' : 'fillOpacity'
  let channelOpacity = 1
  for (let n: Element | null = el; n; n = n.parentElement) {
    const v = declared(n, prop)
    if (v !== null) {
      channelOpacity = v
      break
    }
  }
  let group = 1
  for (let n: Element | null = el; n; n = n.parentElement) {
    refuseClassFade(n)
    group *= levelOpacity(n, 'opacity')
  }
  return channelOpacity * group
}

/** An unconditional Tailwind opacity utility — the fade this reader cannot measure. */
const CLASS_FADE = /^opacity-(\d+|\[.+\])$/
const refuseClassFade = (n: Element) => {
  const faded = (n.getAttribute('class') ?? '').split(/\s+/).filter((c) => CLASS_FADE.test(c))
  if (faded.length) {
    throw new Error(
      `effectiveOpacity cannot read a CSS-class fade: <${n.tagName} class="${faded.join(' ')}">. ` +
        'Reading it would report full opacity for a mark the browser fades — assert the class, ' +
        'or express the fade as a style/attribute the walk can see.',
    )
  }
}
