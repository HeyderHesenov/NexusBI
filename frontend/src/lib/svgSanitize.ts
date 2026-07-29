/**
 * Client-side sanitizer for rendered SVG markup before it is injected via
 * dangerouslySetInnerHTML. This is a THIRD defense layer for AI-generated
 * diagrams (Mermaid), on top of the server-side source sanitizer and mermaid's
 * own `securityLevel: 'strict'` — belt, suspenders, and a second belt.
 *
 * It parses the SVG in an inert document and removes the only things that can
 * execute in an inline-SVG context: <script> elements, `on*` event-handler
 * attributes, and script-bearing URLs on href/src attributes.
 *
 * Returns '' if the input has no <svg> root — callers should treat '' as "do not
 * render this" (fail closed) rather than injecting the raw string.
 */

/** The only data: URLs allowed through. Conspicuously absent is image/svg+xml:
 * it looks like an image and is actually a document, so it can carry its own
 * <script>. Raster types cannot. */
const SAFE_DATA_URL = /^data:image\/(png|jpe?g|gif|webp);/

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
        // Control characters are stripped alongside whitespace: browsers ignore
        // both anywhere inside a scheme, so `java<TAB>script:` and its NUL-byte
        // variant navigate exactly like the bare form.
        const value = attr.value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase()
        // vbscript: still runs in legacy engines, and data: carries script in far
        // more than text/html — so the scheme is rejected wholesale except for the
        // raster image types above, rather than one media type at a time.
        if (
          value.startsWith('javascript:') ||
          value.startsWith('vbscript:') ||
          (value.startsWith('data:') && !SAFE_DATA_URL.test(value))
        ) {
          el.removeAttribute(attr.name)
        }
      }
    }
  }
  return root.outerHTML
}
