import { beforeEach, describe, expect, it } from 'vitest'
import {
  clampFabY,
  defaultFabY,
  FAB,
  GAP,
  MARGIN,
  panelAnchor,
  readFabY,
  TOP_MIN,
  writeFabY,
} from './fabPosition'

beforeEach(() => localStorage.clear())

describe('clampFabY', () => {
  it('clamps to the TopBar guard at the top', () => {
    expect(clampFabY(-50, 800)).toBe(TOP_MIN)
    expect(clampFabY(10, 800)).toBe(TOP_MIN)
  })

  it('clamps to the bottom margin', () => {
    expect(clampFabY(5000, 800)).toBe(800 - FAB - MARGIN)
  })

  it('passes sane values through', () => {
    expect(clampFabY(400, 800)).toBe(400)
  })

  it('is a no-op on degenerate viewports (jsdom vh=0) — never NaN', () => {
    expect(clampFabY(300, 0)).toBe(300)
    expect(Number.isFinite(clampFabY(300, 0))).toBe(true)
  })
})

describe('defaultFabY', () => {
  it('rests at the classic bottom-right spot', () => {
    expect(defaultFabY(800)).toBe(800 - FAB - MARGIN) // 720
  })

  it('parks at the top clamp on tiny viewports', () => {
    expect(defaultFabY(100)).toBe(TOP_MIN)
  })
})

describe('readFabY / writeFabY', () => {
  it('round-trips a stored position', () => {
    writeFabY(333)
    expect(readFabY(800)).toBe(333)
  })

  it('falls back to the default on missing or garbage storage', () => {
    expect(readFabY(800)).toBe(defaultFabY(800))
    localStorage.setItem('nexusbi_copilot_pos', 'not-json{{')
    expect(readFabY(800)).toBe(defaultFabY(800))
    localStorage.setItem('nexusbi_copilot_pos', JSON.stringify({ y: 'high' }))
    expect(readFabY(800)).toBe(defaultFabY(800))
  })

  it('re-clamps a stale position saved on a taller window', () => {
    writeFabY(1500) // saved when the window was tall
    expect(readFabY(600)).toBe(600 - FAB - MARGIN)
  })
})

describe('panelAnchor', () => {
  it('opens below the FAB when there is room', () => {
    const anchor = panelAnchor(100, 1000)
    expect(anchor).toEqual({ top: 100 + FAB + GAP })
  })

  it('flips above the FAB when below does not fit', () => {
    const anchor = panelAnchor(720, 800) // classic bottom spot
    expect(anchor).toEqual({ bottom: 800 - 720 + GAP }) // = 96 → today's bottom-24 look
  })

  it('never anchors closer than 8px to the bottom edge', () => {
    const anchor = panelAnchor(9999, 800)
    expect('bottom' in anchor && anchor.bottom >= 8).toBe(true)
  })
})
