import { describe, expect, it } from 'vitest'
import { CATEGORY_META, CATEGORY_ORDER } from './notificationCategories'

describe('notificationCategories', () => {
  it('defines meta (label + icon) for every user-facing ordered category', () => {
    expect(CATEGORY_ORDER).toHaveLength(5)
    for (const c of CATEGORY_ORDER) {
      expect(CATEGORY_META[c].label).toBeTruthy()
      expect(CATEGORY_META[c].Icon).toBeTruthy()
    }
  })

  it('keeps ai_quality in META but excludes it from the user-facing order (admin-only)', () => {
    expect(CATEGORY_META.ai_quality).toBeTruthy()
    expect(CATEGORY_ORDER).not.toContain('ai_quality')
    // every ordered category is a real meta key
    expect(CATEGORY_ORDER.every((c) => c in CATEGORY_META)).toBe(true)
  })
})
