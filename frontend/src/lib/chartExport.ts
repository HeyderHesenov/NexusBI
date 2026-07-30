/**
 * Chart image export: turn a rendered <svg> into a downloadable .svg or .png.
 *
 * One canonical implementation shared by every chart surface (query view, chat
 * share card, dashboard widgets) and the knowledge graph — the technique first
 * appeared inside ForceGraph's imperative handle, where nothing else could reach
 * it and nothing tested it.
 *
 * Why this works at all: recharts writes colours and sizes as SVG *attributes*
 * (see components/charts/theme.ts — hard-coded hex values passed as props), not
 * as CSS. A serialized clone therefore keeps its appearance without any
 * style-inlining pass. The two things it does NOT inherit are the page
 * background and the font, which is exactly what prepareSvgForExport adds.
 */
import type { ChartType } from '../types'
import { downloadBlob } from './download'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Matches the app's body font so exported text looks like the on-screen chart. */
const DEFAULT_FONT = "'Inter', ui-sans-serif, system-ui, sans-serif"

/** Raster exports are drawn at 2× so they stay crisp in slides and print. */
const RASTER_SCALE = 2

/** Used only when a chart is exported before layout has given it a size. */
const FALLBACK_SIZE = { width: 800, height: 400 }

/**
 * Chart types that render through recharts, i.e. as an <svg> we can serialize.
 * `table`, `pivot` and `kpi_card` are plain DOM (see ChartRenderer) — offering
 * "download as image" for them would need a whole DOM rasterizer, so callers
 * hide the option instead of shipping one that fails.
 */
export const IMAGE_EXPORTABLE: ReadonlySet<ChartType> = new Set<ChartType>([
  'bar',
  'line',
  'area',
  'pie',
  'scatter',
])

export function isImageExportable(type: ChartType): boolean {
  return IMAGE_EXPORTABLE.has(type)
}

/** Build a tidy download name from a chart/widget title. */
export function exportFilename(title: string, ext: 'csv' | 'png' | 'svg'): string {
  const slug = title
    .trim()
    .toLowerCase()
    // Unicode letter/number classes, so Azerbaijani titles keep their letters
    // instead of collapsing to a row of dashes.
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '') // the slice may have landed mid-separator
  return `nexusbi-${slug || 'export'}.${ext}`
}

/**
 * The <svg> to export from a chart container. Prefers recharts' own surface
 * class: a container may also hold decorative icon SVGs, and the first one in
 * document order is not necessarily the chart. Falls back to the first <svg> so
 * the knowledge graph (not a recharts surface) works through the same path.
 */
export function findChartSvg(container: HTMLElement | null): SVGSVGElement | null {
  if (!container) return null
  return (
    container.querySelector<SVGSVGElement>('svg.recharts-surface') ??
    container.querySelector<SVGSVGElement>('svg')
  )
}

/** Serialize an <svg> element to a standalone string (namespace included). */
export function serializeSvg(el: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(el)
}

/**
 * The user-space box the background rect must cover.
 *
 * A percentage rect resolves against the viewport, which silently assumes the
 * user-space origin is 0,0. That holds for recharts but not for a panned canvas:
 * the knowledge graph's viewBox origin follows its pan offset, so a rect at 0,0
 * would sit wherever the user last scrolled from. Read the viewBox when there is
 * one and cover exactly it; percentages remain the fallback.
 */
function backgroundBox(el: SVGSVGElement): {
  x: string
  y: string
  width: string
  height: string
} {
  const parts = (el.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length === 4 && parts.every(Number.isFinite)) {
    const [x, y, width, height] = parts
    return { x: String(x), y: String(y), width: String(width), height: String(height) }
  }
  return { x: '0', y: '0', width: '100%', height: '100%' }
}

/**
 * Clone the chart and make the clone stand on its own:
 *
 *  - an opaque background rect, because the on-screen surface colour comes from
 *    a CSS class that does not travel with the element (a transparent PNG turns
 *    into black-on-black the moment it lands in a dark slide deck);
 *  - an explicit font-family, because recharts sets font *size* per element but
 *    inherits the family from the page.
 *
 * The rect goes in as the first child so it paints behind every mark. Pure: the
 * live chart is never mutated.
 */
export function prepareSvgForExport(
  el: SVGSVGElement,
  opts: { background: string; fontFamily?: string },
): SVGSVGElement {
  const clone = el.cloneNode(true) as SVGSVGElement
  const bg = document.createElementNS(SVG_NS, 'rect')
  for (const [name, value] of Object.entries(backgroundBox(el))) {
    bg.setAttribute(name, value)
  }
  bg.setAttribute('fill', opts.background)
  clone.insertBefore(bg, clone.firstChild)
  clone.setAttribute('font-family', opts.fontFamily ?? DEFAULT_FONT)
  return clone
}

/** Rendered size of the chart, falling back to its attributes then a default. */
function measure(el: SVGSVGElement): { width: number; height: number } {
  const rect = el.getBoundingClientRect()
  if (rect.width >= 1 && rect.height >= 1) {
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  }
  const w = Number(el.getAttribute('width'))
  const h = Number(el.getAttribute('height'))
  if (Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1) {
    return { width: w, height: h }
  }
  return FALLBACK_SIZE
}

/** UTF-8-safe base64. Chunked so a large SVG neither blows the call stack via
 *  spread nor spends time on per-character string concatenation. */
function toBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export interface ChartExportOptions {
  /** Surface colour painted behind the chart — pass useChartTheme().SURFACE. */
  background: string
  fontFamily?: string
}

/** Download the chart as a standalone .svg file. */
export function downloadChartSvg(
  el: SVGSVGElement,
  filename: string,
  opts: ChartExportOptions,
): void {
  const src = serializeSvg(prepareSvgForExport(el, opts))
  downloadBlob(new Blob([src], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

/**
 * Rasterize the chart and download it as a PNG at RASTER_SCALE×.
 *
 * The intermediate image is a `data:` URL on purpose. The production CSP
 * (vite.config.ts) allows `img-src 'self' data:` and deliberately does NOT list
 * `blob:` — switching to URL.createObjectURL here would work in dev and fail
 * silently once built.
 */
export function downloadChartPng(
  el: SVGSVGElement,
  filename: string,
  opts: ChartExportOptions,
): Promise<void> {
  const { width, height } = measure(el)
  const clone = prepareSvgForExport(el, opts)
  // Stamp the measured size on the clone: a chart sized by its container can
  // carry width="100%", which gives the decoded image no intrinsic dimensions.
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const src = serializeSvg(clone)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * RASTER_SCALE
      canvas.height = height * RASTER_SCALE
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('canvas 2d context unavailable'))
        return
      }
      // The rect inside the SVG covers the same area, but filling here too keeps
      // the PNG opaque even if the SVG failed to lay the rect out.
      ctx.fillStyle = opts.background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('canvas.toBlob returned null'))
          return
        }
        downloadBlob(blob, filename)
        resolve()
      }, 'image/png')
    }
    img.onerror = () => reject(new Error('could not decode the serialized chart'))
    img.src = `data:image/svg+xml;base64,${toBase64Utf8(src)}`
  })
}
