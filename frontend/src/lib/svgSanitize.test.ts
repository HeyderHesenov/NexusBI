import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from './svgSanitize'

describe('sanitizeSvg', () => {
  it('returns empty string for empty/rootless input', () => {
    expect(sanitizeSvg('')).toBe('')
    expect(sanitizeSvg('<div>no svg here</div>')).toBe('')
  })

  it('preserves a normal svg with text and shapes', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/><text>hi</text></svg>')
    expect(out).toContain('<svg')
    expect(out).toContain('<rect')
    expect(out).toContain('hi')
    // camelCase SVG attribute case must survive the HTML parse.
    expect(out).toContain('viewBox')
  })

  it('strips <script> elements', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('<rect')
  })

  it('strips on* event-handler attributes', () => {
    const out = sanitizeSvg('<svg><rect onload="alert(1)" onclick="steal()"/></svg>')
    expect(out.toLowerCase()).not.toContain('onload')
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out).toContain('<rect')
  })

  it('strips javascript: URLs on href/xlink:href', () => {
    const out = sanitizeSvg('<svg><a href="javascript:alert(1)"><rect/></a></svg>')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out).toContain('<rect')
  })

  it('keeps benign hrefs', () => {
    const out = sanitizeSvg('<svg><a href="https://example.com"><rect/></a></svg>')
    expect(out).toContain('https://example.com')
  })

  it('preserves the renderable parts of a mermaid-style svg', () => {
    // Guards against the parse→serialize round-trip mangling real diagrams:
    // <style>, <marker>, url(#id) refs, gradients and camelCase SVG attributes.
    const svg = `<svg id="g" viewBox="0 0 200 100" preserveAspectRatio="xMidYMid" xmlns="http://www.w3.org/2000/svg">
<style>.node rect{fill:#eee}</style>
<defs><marker id="arrow" markerWidth="6" orient="auto"><path d="M0,0"/></marker>
<linearGradient id="grad" gradientUnits="userSpaceOnUse"><stop offset="0%"/></linearGradient></defs>
<g class="node"><rect width="40" height="20"/><path marker-end="url(#arrow)" d="M0,0L10,10"/>
<text fill="url(#grad)">Start</text></g></svg>`
    const out = sanitizeSvg(svg)
    for (const needle of [
      '<svg', 'viewBox', 'preserveAspectRatio', '<style', 'markerWidth',
      'url(#arrow)', 'url(#grad)', 'gradientUnits', 'Start',
    ]) {
      expect(out, needle).toContain(needle)
    }
  })
})
