import { describe, expect, it } from 'vitest'
import { CATEGORY_META, CATEGORY_ORDER } from './notificationCategories'

describe('notificationCategories', () => {
  it('defines meta (label + icon) for every ordered category', () => {
    expect(CATEGORY_ORDER).toHaveLength(6)
    for (const c of CATEGORY_ORDER) {
      expect(CATEGORY_META[c].label).toBeTruthy()
      expect(CATEGORY_META[c].Icon).toBeTruthy()
    }
  })

  it('meta keys and order cover exactly the same categories', () => {
    expect([...CATEGORY_ORDER].sort()).toEqual(Object.keys(CATEGORY_META).sort())
  })
})
