import { describe, expect, it } from 'vitest'
import {
  exportFilename,
  findChartSvg,
  isImageExportable,
  prepareSvgForExport,
  serializeSvg,
} from './chartExport'

/** A stand-in for a rendered recharts surface: a sized <svg> with one mark. */
function makeSvg(): SVGSVGElement {
  const host = document.createElement('div')
  host.innerHTML =
    '<svg class="recharts-surface" width="400" height="300" viewBox="0 0 400 300">' +
    '<rect class="mark" x="10" y="10" width="80" height="40" fill="#0E9F6E"></rect>' +
    '</svg>'
  return host.querySelector('svg') as SVGSVGElement
}

describe('prepareSvgForExport', () => {
  it('inserts an opaque background as the FIRST child so it sits behind the marks', () => {
    const out = prepareSvgForExport(makeSvg(), { background: '#FFFFFF' })
    const first = out.firstElementChild as SVGRectElement
    expect(first.tagName.toLowerCase()).toBe('rect')
    expect(first.getAttribute('fill')).toBe('#FFFFFF')
    // Painted over the whole surface, not the mark's 80x40 box.
    expect(first.getAttribute('width')).toBe('400')
    expect(first.getAttribute('height')).toBe('300')
    // The real mark must still be there, after the background.
    expect(out.querySelector('.mark')).not.toBeNull()
  })

  it('covers the viewBox rather than 0,0 — a panned canvas has a shifted origin', () => {
    const host = document.createElement('div')
    // The knowledge graph pans by moving its viewBox origin (ForceGraph.tsx:388).
    host.innerHTML = '<svg viewBox="120 -40 800 600"><circle r="5"></circle></svg>'
    const svg = host.querySelector('svg') as SVGSVGElement
    const bg = prepareSvgForExport(svg, { background: '#171615' }).firstElementChild!
    expect(bg.getAttribute('x')).toBe('120')
    expect(bg.getAttribute('y')).toBe('-40')
    expect(bg.getAttribute('width')).toBe('800')
    expect(bg.getAttribute('height')).toBe('600')
  })

  it('falls back to percentages when there is no viewBox', () => {
    const host = document.createElement('div')
    host.innerHTML = '<svg width="200" height="100"></svg>'
    const svg = host.querySelector('svg') as SVGSVGElement
    const bg = prepareSvgForExport(svg, { background: '#FFF' }).firstElementChild!
    expect(bg.getAttribute('x')).toBe('0')
    expect(bg.getAttribute('width')).toBe('100%')
    expect(bg.getAttribute('height')).toBe('100%')
  })

  it('sets an explicit font-family — recharts inherits it from CSS, which a standalone file has none of', () => {
    const out = prepareSvgForExport(makeSvg(), { background: '#FFFFFF' })
    expect(out.getAttribute('font-family')).toContain('Inter')
  })

  it('honours a caller-supplied font-family', () => {
    const out = prepareSvgForExport(makeSvg(), { background: '#FFF', fontFamily: 'Georgia, serif' })
    expect(out.getAttribute('font-family')).toBe('Georgia, serif')
  })

  it('leaves the live chart untouched — it clones', () => {
    const live = makeSvg()
    const out = prepareSvgForExport(live, { background: '#FFFFFF' })
    expect(out).not.toBe(live)
    expect(live.getAttribute('font-family')).toBeNull()
    // The on-screen chart must not gain an export-only background rect.
    expect(live.firstElementChild?.classList.contains('mark')).toBe(true)
  })
})

describe('serializeSvg', () => {
  it('declares the SVG namespace so the .svg file opens standalone', () => {
    const out = serializeSvg(prepareSvgForExport(makeSvg(), { background: '#FFFFFF' }))
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out.startsWith('<svg')).toBe(true)
  })

  it('keeps the colours, which recharts writes as attributes rather than CSS', () => {
    const out = serializeSvg(prepareSvgForExport(makeSvg(), { background: '#FFFFFF' }))
    expect(out).toContain('#0E9F6E')
  })
})

describe('exportFilename', () => {
  it('slugifies a title and appends the extension', () => {
    expect(exportFilename('Monthly Revenue', 'png')).toBe('nexusbi-monthly-revenue.png')
  })

  it('keeps non-ASCII letters — Azerbaijani titles must survive', () => {
    expect(exportFilename('Aylıq gəlir', 'svg')).toBe('nexusbi-aylıq-gəlir.svg')
  })

  it('collapses punctuation runs and trims the edges', () => {
    expect(exportFilename('  Q1 // 2026 — sales!  ', 'csv')).toBe('nexusbi-q1-2026-sales.csv')
  })

  it('falls back when the title slugifies to nothing', () => {
    expect(exportFilename('///', 'png')).toBe('nexusbi-export.png')
    expect(exportFilename('', 'png')).toBe('nexusbi-export.png')
  })

  it('caps the slug so the filename stays sane', () => {
    const name = exportFilename('a'.repeat(200), 'png')
    expect(name).toBe(`nexusbi-${'a'.repeat(60)}.png`)
  })
})

describe('isImageExportable', () => {
  it('accepts the recharts (SVG) chart types', () => {
    for (const t of ['bar', 'line', 'area', 'pie', 'scatter'] as const) {
      expect(isImageExportable(t)).toBe(true)
    }
  })

  it('rejects the DOM-rendered types — there is no <svg> to serialize', () => {
    for (const t of ['table', 'pivot', 'kpi_card'] as const) {
      expect(isImageExportable(t)).toBe(false)
    }
  })
})

describe('findChartSvg', () => {
  it('prefers the recharts surface over any other svg in the container', () => {
    const host = document.createElement('div')
    host.innerHTML =
      '<svg id="icon"></svg><div><svg id="surface" class="recharts-surface"></svg></div>'
    expect(findChartSvg(host)?.id).toBe('surface')
  })

  it('falls back to the first svg — the knowledge graph is not a recharts surface', () => {
    const host = document.createElement('div')
    host.innerHTML = '<svg id="graph"></svg>'
    expect(findChartSvg(host)?.id).toBe('graph')
  })

  it('returns null for an empty or missing container', () => {
    expect(findChartSvg(null)).toBeNull()
    expect(findChartSvg(document.createElement('div'))).toBeNull()
  })
})
