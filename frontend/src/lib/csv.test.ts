import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCsv } from './csv'

// Return a plain anchor stub for <a> so the real jsdom click (which warns about
// navigation) never runs; everything else creates normally.
beforeEach(() => {
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
    tag === 'a' ? ({ href: '', download: '', click: () => {} } as unknown as HTMLElement) : real(tag),
  )
})
afterEach(() => vi.restoreAllMocks())

/** Capture the text written into the Blob downloadCsv builds. */
function captureCsv(rows: Record<string, unknown>[]): string {
  let captured = ''
  const origBlob = globalThis.Blob
  // @ts-expect-error — minimal Blob stub that records its text payload.
  globalThis.Blob = class {
    constructor(parts: string[]) {
      captured = parts.join('')
    }
  }
  try {
    downloadCsv(rows, 'test.csv')
  } finally {
    globalThis.Blob = origBlob
  }
  return captured
}

describe('downloadCsv', () => {
  it('does nothing for empty rows', () => {
    expect(captureCsv([])).toBe('')
  })

  it('writes a header row and a BOM', () => {
    const csv = captureCsv([{ a: 1, b: 2 }])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('a,b')
    expect(csv).toContain('1,2')
  })

  it('quotes values containing commas, quotes, or newlines', () => {
    const csv = captureCsv([{ a: 'x,y', b: 'he said "hi"' }])
    expect(csv).toContain('"x,y"')
    expect(csv).toContain('"he said ""hi"""')
  })

  it('neutralizes formula-injection leads (=, +, -, @)', () => {
    const csv = captureCsv([{ a: '=SUM(A1:A9)', b: '+1', c: '-2', d: '@cmd' }])
    expect(csv).toContain("'=SUM(A1:A9)")
    expect(csv).toContain("'+1")
    expect(csv).toContain("'-2")
    expect(csv).toContain("'@cmd")
  })

  it('renders null/undefined as empty cells', () => {
    const csv = captureCsv([{ a: null, b: undefined, c: 0 }])
    const dataLine = csv.split('\n')[1]
    expect(dataLine).toBe(',,0')
  })
})
