/** Position math for the draggable copilot FAB.
 *
 * The FAB is pinned to the RIGHT edge and slides vertically only; the panel
 * flips above/below it depending on where the FAB sits. Pure functions so the
 * clamp/anchor logic is unit-testable without a DOM. */

const KEY = 'nexusbi_copilot_pos'

export const FAB = 56 // h-14
export const MARGIN = 24 // bottom-6 / right-6 breathing room
export const TOP_MIN = 72 // keeps the FAB clear of the TopBar controls
export const PANEL_H = 512 // h-[32rem]
export const GAP = 16 // FAB↔panel spacing (today's bottom-6/bottom-24 look)

export function defaultFabY(vh: number): number {
  // Today's resting spot: bottom-right. Tiny viewports park it at the top clamp.
  return vh > TOP_MIN + FAB + MARGIN ? vh - FAB - MARGIN : TOP_MIN
}

export function clampFabY(y: number, vh: number): number {
  // Degenerate viewport (jsdom reports 0): pass through rather than emit NaN styles.
  if (vh <= TOP_MIN + FAB + MARGIN) return y
  return Math.min(Math.max(y, TOP_MIN), vh - FAB - MARGIN)
}

export function readFabY(vh: number): number {
  try {
    const y = (JSON.parse(localStorage.getItem(KEY) ?? '') as { y?: unknown })?.y
    if (typeof y === 'number' && Number.isFinite(y)) return clampFabY(y, vh)
  } catch {
    /* missing or garbage entry → default */
  }
  return defaultFabY(vh)
}

export function writeFabY(y: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ y }))
  } catch {
    /* storage unavailable — position just won't persist */
  }
}

/** Panel opens below the FAB when it fits, else anchors above it. */
export function panelAnchor(fabY: number, vh: number): { top: number } | { bottom: number } {
  if (fabY + FAB + GAP + PANEL_H <= vh - 8) return { top: fabY + FAB + GAP }
  return { bottom: Math.max(8, vh - fabY + GAP) }
}
