import { describe, expect, it } from 'vitest'
import az from './locales/az.json'
import en from './locales/en.json'
import ru from './locales/ru.json'
import tr from './locales/tr.json'

/** i18n is configured with fallbackLng 'az' and returnEmptyString: false, so a key
 * missing from ru/tr renders Azerbaijani to that user instead of failing — no
 * error, no test, nothing in CI. Four locales kept aligned by hand is a matter of
 * time; this makes forgetting one a failing test instead of a silent bug. */
function leaves(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  )
}

const base = leaves(az).sort()

describe('locale parity', () => {
  it.each([
    ['en', en],
    ['ru', ru],
    ['tr', tr],
  ])('%s has exactly the same keys as az', (_name, catalog) => {
    expect(leaves(catalog).sort()).toEqual(base)
  })

  it('has no empty values, which would silently fall back to az', () => {
    for (const [name, catalog] of [
      ['az', az],
      ['en', en],
      ['ru', ru],
      ['tr', tr],
    ] as const) {
      const empty = leaves(catalog).filter((path) => {
        const value = path.split('.').reduce<any>((o, k) => o?.[k], catalog)
        return typeof value === 'string' && value.trim() === ''
      })
      expect(empty, `${name} has empty strings`).toEqual([])
    }
  })
})
