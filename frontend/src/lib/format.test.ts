import { describe, expect, it } from 'vitest'
import { formatNumber, formatMetricValue, formatSignedPct, localeFor } from './format'

describe('formatNumber', () => {
  it('formats plain numbers with the default locale', () => {
    // az-AZ uses a non-breaking space as the grouping separator.
    expect(formatNumber(1234)).toMatch(/1.234/)
  })

  it('compacts large numbers', () => {
    expect(formatNumber(1234, { compact: true, locale: 'en-US' })).toBe('1.2K')
    expect(formatNumber(2_500_000, { compact: true, locale: 'en-US' })).toBe('2.5M')
  })

  it('treats decimals as a maximum (no forced trailing zeros)', () => {
    expect(formatNumber(3.14159, { decimals: 2, locale: 'en-US' })).toBe('3.14')
    // Integer input keeps no fraction — decimals is a cap, not a fixed width.
    expect(formatNumber(5, { decimals: 2, locale: 'en-US' })).toBe('5')
    expect(formatNumber(1234, { locale: 'en-US' })).toBe('1,234')
  })

  it('applies currency styling', () => {
    expect(formatNumber(1200, { currency: 'USD', locale: 'en-US' })).toMatch(/\$1,200/)
  })

  it('renders non-finite input as an em dash', () => {
    expect(formatNumber(NaN)).toBe('—')
    expect(formatNumber(Infinity)).toBe('—')
  })

  it('respects the requested locale', () => {
    // en-US uses a comma group separator; the default (az-AZ) does not.
    expect(formatNumber(1000, { locale: 'en-US' })).toBe('1,000')
  })
})

describe('localeFor', () => {
  it('maps every app language to a BCP-47 locale', () => {
    expect(localeFor('az')).toBe('az-AZ')
    expect(localeFor('en')).toBe('en-US')
    expect(localeFor('ru')).toBe('ru-RU')
    expect(localeFor('tr')).toBe('tr-TR')
  })
})

describe('formatMetricValue (unchanged behavior)', () => {
  it('keeps 2-decimal precision below 1000', () => {
    expect(formatMetricValue(12.345)).toBe('12.35')
    expect(formatMetricValue(7)).toBe('7')
  })

  it('groups values at or above 1000', () => {
    expect(formatMetricValue(1500)).toMatch(/1.500/)
  })
})

describe('formatSignedPct', () => {
  it('prefixes a sign and appends percent', () => {
    expect(formatSignedPct(12.34)).toBe('+12.3%')
    expect(formatSignedPct(-5)).toBe('-5%')
    expect(formatSignedPct(0)).toBe('+0%')
  })
})
