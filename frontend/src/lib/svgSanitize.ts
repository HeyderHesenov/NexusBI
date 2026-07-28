/**
 * Client-side sanitizer for rendered SVG markup before it is injected via
 * dangerouslySetInnerHTML. This is a THIRD defense layer for AI-generated
 * diagrams (Mermaid), on top of the server-side source sanitizer and mermaid's
 * own `securityLevel: 'strict'` — belt, suspenders, and a second belt.
 *
 * It parses the SVG in an inert document and removes the only things that can
 * execute in an inline-SVG context: <script> elements, `on*` event-handler
 * attributes, and `javascript:` / `data:text/html` URLs on href/src attributes.
 *
 * Returns '' if the input has no <svg> root — callers should treat '' as "do not
 * render this" (fail closed) rather than injecting the raw string.
 */
export function sanitizeSvg(svg: string): string {
  if (!svg) return ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svg, 'text/html')
  } catch {
    return ''
  }
  const root = doc.body.querySelector('svg')
  if (!root) return ''

  root.querySelectorAll('script').forEach((el) => el.remove())

  const URL_ATTRS = new Set(['href', 'xlink:href', 'src'])
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRS.has(name)) {
        const value = attr.value.replace(/\s+/g, '').toLowerCase()
        if (value.startsWith('javascript:') || value.startsWith('data:text/html')) {
          el.removeAttribute(attr.name)
        }
      }
    }
  }
  return root.outerHTML
}
