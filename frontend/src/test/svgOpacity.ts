/**
 * Opacity as the screen actually composites it: SVG group opacity multiplies
 * through to every descendant, so an element's own attribute is only the last
 * term of the product.
 *
 * ⚠️ THE FIRST VERSION OF THIS READ `ring.getAttribute('opacity')` AND WAS WRONG.
 * The node's wrapper <g> carried `opacity={dimmed ? 0.2 : 1}`, so a ring declaring
 * 0.9 painted at 0.18 — worse than the 0.4 that ticket set out to fix — while the
 * test read 0.9, composited from it, and reported a comfortable 4.60:1. Rendering
 * instead of grepping the source was not enough on its own; the quantity has to be
 * the one the eye receives, and a screenshot of the real app is what exposed the gap.
 *
 * ⚠️ AND WALKING THE ANCESTORS WAS STILL NOT ENOUGH. The second version read only
 * the `opacity` presentation ATTRIBUTE, so the identical defect came back verbatim
 * when spelled `style={{ opacity: dimmed ? 0.2 : 1 }}` — measured, all 759 tests
 * stayed green while the ring painted at 0.18 again. Inline style is not an exotic
 * spelling; it WINS over the presentation attribute in the cascade, and it is how
 * half of `ForceGraph` already sets `pointerEvents`. So each level takes style
 * first and falls back to the attribute, and the three opacity properties that can
 * fade a stroke are all read — `opacity` on any ancestor, plus `stroke-opacity` on
 * the mark itself, either of which would otherwise fade a stroke invisibly.
 *
 * Shared rather than copied: two suites now measure painted marks — the trust ring
 * and the chart palette — and a second hand-written copy is how the two versions
 * above came to disagree about what "opacity" meant in the first place.
 */
export const levelOpacity = (n: Element, prop: 'opacity' | 'strokeOpacity'): number => {
  const attr = prop === 'opacity' ? 'opacity' : 'stroke-opacity'
  const inline = (n as SVGElement).style?.[prop]
  const raw = inline !== undefined && inline !== '' ? inline : n.getAttribute(attr)
  if (raw === null || raw === undefined) return 1
  // A percentage is legal SVG and `Number()` returns NaN for it — surface that as
  // a failure rather than letting NaN silently poison the product.
  const v = raw.trim().endsWith('%') ? Number(raw.trim().slice(0, -1)) / 100 : Number(raw)
  if (!Number.isFinite(v)) throw new Error(`unreadable ${attr} on <${n.tagName}>: "${raw}"`)
  return v
}

export const effectiveOpacity = (el: Element): number => {
  let o = levelOpacity(el, 'strokeOpacity')
  for (let n: Element | null = el; n; n = n.parentElement) o *= levelOpacity(n, 'opacity')
  return o
}
