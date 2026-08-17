/**
 * The measuring instrument, measured.
 *
 * Two suites read painted opacity through this helper and both state their
 * conclusions as inequalities — "at least 3:1", "exactly 1" — so a reader that
 * silently returns 1 makes every one of them pass. Three versions of it have
 * shipped and each missed a spelling the previous one did not think of, so the
 * cases below are the list of those misses plus the composition rules that make
 * the two channels behave differently.
 */
import { describe, expect, it } from 'vitest'
import { effectiveOpacity, levelOpacity } from './svgOpacity'

/** `<svg><g {outer}><path {inner}/></g></svg>`, returning the path. */
const mark = (outer = '', inner = ''): Element => {
  const host = document.createElement('div')
  host.innerHTML = `<svg><g ${outer}><path ${inner}/></g></svg>`
  const path = host.querySelector('path')
  if (!path) throw new Error('fixture did not build')
  return path
}

describe('effectiveOpacity', () => {
  it('is 1 when nothing fades the mark', () => {
    expect(effectiveOpacity(mark())).toBe(1)
    expect(effectiveOpacity(mark(), 'fill')).toBe(1)
  })

  it.each([
    ['own attribute', '', 'stroke-opacity="0.4"', 0.4],
    ['own inline style', '', 'style="stroke-opacity: 0.4"', 0.4],
    ['ancestor attribute — stroke-opacity INHERITS', 'stroke-opacity="0.4"', '', 0.4],
    ['ancestor inline style', 'style="stroke-opacity: 0.4"', '', 0.4],
    ['group opacity on the ancestor', 'opacity="0.4"', '', 0.4],
    ['group opacity as inline style', 'style="opacity: 0.4"', '', 0.4],
    ['group opacity on the mark itself', '', 'opacity="0.4"', 0.4],
    ['a percentage, which Number() alone turns into NaN', '', 'stroke-opacity="40%"', 0.4],
  ])('reads %s', (_label, outer, inner, expected) => {
    expect(effectiveOpacity(mark(outer, inner))).toBeCloseTo(expected, 10)
  })

  it('lets the style win over the attribute on the SAME element, as the cascade says', () => {
    // Moved here from `ForceGraph.test`, which held a second copy of this whole
    // suite after the helper was extracted. Two hand-written suites for one
    // instrument is the shape of the disagreement that produced its first three
    // versions; this was the one case the copy asserted and this file did not.
    const el = mark('', 'opacity="1" style="opacity: 0.4"')
    expect(effectiveOpacity(el)).toBeCloseTo(0.4, 10)
    expect(levelOpacity(el, 'opacity')).toBeCloseTo(0.4, 10)
  })

  it('multiplies group opacity down the chain but does NOT multiply the inherited channel', () => {
    // `opacity` composites per group, so two 0.5s make 0.25…
    expect(effectiveOpacity(mark('opacity="0.5"', 'opacity="0.5"'))).toBeCloseTo(0.25, 10)
    // …while `stroke-opacity` is inherited, so the nearest declaration WINS and
    // the ancestor's contributes nothing. Multiplying here — the obvious-looking
    // fix, and the one this helper's review suggested — would report 0.25 for a
    // mark the browser paints at 0.5.
    expect(effectiveOpacity(mark('stroke-opacity="0.5"', 'stroke-opacity="0.5"'))).toBeCloseTo(0.5, 10)
    // The two do combine with each other, though.
    expect(effectiveOpacity(mark('opacity="0.5"', 'stroke-opacity="0.5"'))).toBeCloseTo(0.25, 10)
  })

  it('keeps the two channels apart', () => {
    // A filled mark faded only on its fill must still read as a full-strength
    // stroke, and the other way round — one number for both would let a widget
    // wash out its fill and stay green on a stroke assertion, or vice versa.
    expect(effectiveOpacity(mark('', 'fill-opacity="0.08"'), 'fill')).toBeCloseTo(0.08, 10)
    expect(effectiveOpacity(mark('', 'fill-opacity="0.08"'), 'stroke')).toBe(1)
    expect(effectiveOpacity(mark('', 'stroke-opacity="0.3"'), 'fill')).toBe(1)
  })

  it('refuses a CSS-class fade rather than reporting the mark as opaque', () => {
    // The fourth spelling, and the one this reader genuinely cannot resolve: a
    // Tailwind utility resolves through neither `style` nor the attribute, and
    // jsdom loads no stylesheet to resolve it from. Both callers ask "is this 1?"
    // or "is this at least 3:1?", so a silent 1 here reads as a pass on a mark the
    // browser is fading. It throws instead.
    expect(() => effectiveOpacity(mark('class="opacity-40"'))).toThrow(/CSS-class fade/)
    expect(() => effectiveOpacity(mark('', 'class="opacity-[0.4]"'))).toThrow(/CSS-class fade/)
    // …but a CONDITIONAL utility is not a fade until its condition holds, and
    // evaluating that is not this function's job. The repo ships several.
    expect(effectiveOpacity(mark('class="disabled:opacity-40 hover:opacity-60"'))).toBe(1)
    // And an unrelated class must not trip it — the regex is anchored for this.
    expect(effectiveOpacity(mark('class="opacity-guard fill-opacity-x"'))).toBe(1)
  })

  it('refuses a value it cannot read rather than returning NaN', () => {
    // NaN propagates into `toBeCloseTo` as a failure, but into a `>=` comparison
    // as a silent false — and into a product as a silent poison. Named here.
    expect(() => effectiveOpacity(mark('', 'stroke-opacity="none"'))).toThrow(/unreadable/)
    expect(levelOpacity(mark(), 'opacity')).toBe(1)
  })
})
