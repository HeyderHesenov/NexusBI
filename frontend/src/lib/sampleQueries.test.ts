import { describe, expect, it } from 'vitest'
import { buildSamples } from './sampleQueries'
import type { DataSourceSchema } from '../types'

describe('buildSamples', () => {
  it('builds sum + top-N prompts for a numeric+categorical table', () => {
    const schema: DataSourceSchema = {
      sales: [
        { name: 'region', type: 'text' },
        { name: 'revenue', type: 'numeric' },
      ],
    }
    const out = buildSamples(schema)
    expect(out).toContain('region üzrə revenue cəmi')
    expect(out).toContain('sales: revenue üzrə top 10')
  })

  it('falls back to a count prompt when only categorical columns exist', () => {
    const schema: DataSourceSchema = {
      customers: [{ name: 'city', type: 'varchar' }],
    }
    expect(buildSamples(schema)).toEqual(['city üzrə customers sayı'])
  })

  it('adds a trend prompt when numeric and date columns are present', () => {
    const schema: DataSourceSchema = {
      orders: [
        { name: 'amount', type: 'int' },
        { name: 'created_at', type: 'timestamp' },
      ],
    }
    const out = buildSamples(schema)
    expect(out).toContain('created_at üzrə amount trendi')
  })

  it('respects the max cap', () => {
    const schema: DataSourceSchema = {
      a: [{ name: 'cat', type: 'text' }, { name: 'n', type: 'float' }],
      b: [{ name: 'cat', type: 'text' }, { name: 'n', type: 'float' }],
      c: [{ name: 'cat', type: 'text' }, { name: 'n', type: 'float' }],
    }
    expect(buildSamples(schema, 3)).toHaveLength(3)
  })

  it('returns nothing for an empty schema', () => {
    expect(buildSamples({})).toEqual([])
  })
})
