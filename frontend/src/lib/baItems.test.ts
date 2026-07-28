import { describe, expect, it } from 'vitest'
import { byPriority, factMap, resolveEvidence, toItems } from './baItems'
import type { BAFact, BAItem } from '../types'

describe('toItems', () => {
  it('reads legacy bare-string buckets', () => {
    // Artifacts saved before the evidence layer must still render.
    expect(toItems(['Güclü komanda', 'Zəif kanal'])).toEqual([
      { text: 'Güclü komanda', evidence: [], derived: false },
      { text: 'Zəif kanal', evidence: [], derived: false },
    ])
  })

  it('reads the new object shape', () => {
    expect(toItems([{ text: 'Trend mənfi', evidence: ['f1'], derived: true }])).toEqual([
      { text: 'Trend mənfi', evidence: ['f1'], derived: true },
    ])
  })

  it('reads a mixed bucket', () => {
    const out = toItems(['legacy', { text: 'new', evidence: ['f1'], derived: true }])
    expect(out.map((i) => [i.text, i.derived])).toEqual([
      ['legacy', false],
      ['new', true],
    ])
  })

  it('trims and drops entries with no text', () => {
    expect(toItems(['  ', '', { text: '   ' }, { evidence: ['f1'] }, ' ok '])).toEqual([
      { text: 'ok', evidence: [], derived: false },
    ])
  })

  it('defaults derived to false and evidence to an empty array', () => {
    // A missing `derived` must never read as data-backed.
    expect(toItems([{ text: 'x' }])).toEqual([{ text: 'x', evidence: [], derived: false }])
    expect(toItems([{ text: 'x', derived: 'yes' }])[0].derived).toBe(false)
  })

  it('drops non-string evidence ids', () => {
    expect(toItems([{ text: 'x', evidence: ['f1', 2, null], derived: true }])[0].evidence).toEqual([
      'f1',
    ])
  })

  it('survives undefined, null and non-arrays', () => {
    expect(toItems(undefined)).toEqual([])
    expect(toItems(null)).toEqual([])
    expect(toItems('not an array')).toEqual([])
    expect(toItems({ text: 'not an array either' })).toEqual([])
  })

  it('drops entries that are neither a string nor an object', () => {
    // A bare number in a bucket is malformed content, not a bullet to coerce.
    expect(toItems([null, undefined, 42, true])).toEqual([])
  })
})

describe('resolveEvidence', () => {
  const facts: BAFact[] = [
    { id: 'f1', kind: 'trend', label: '', value: '-12%' },
    { id: 'f2', kind: 'concentration', label: 'Books', value: '47%' },
  ]
  const map = factMap(facts)

  it('resolves cited ids in order', () => {
    const item: BAItem = { text: 'x', evidence: ['f2', 'f1'], derived: true }
    expect(resolveEvidence(item, map).map((f) => f.id)).toEqual(['f2', 'f1'])
  })

  it('skips ids with no matching fact', () => {
    // An artifact whose facts were capped can still hold a stale id.
    const item: BAItem = { text: 'x', evidence: ['f1', 'f99'], derived: true }
    expect(resolveEvidence(item, map).map((f) => f.id)).toEqual(['f1'])
  })

  it('factMap tolerates undefined and id-less facts', () => {
    expect(factMap(undefined).size).toBe(0)
    expect(factMap([{ id: '', kind: 'total', label: '', value: '1' }]).size).toBe(0)
  })
})

describe('byPriority', () => {
  it('orders by impact minus effort, descending', () => {
    const actions = [
      { text: 'low', impact: 2, effort: 4 }, // -2
      { text: 'quick', impact: 5, effort: 1 }, // +4
      { text: 'mid', impact: 4, effort: 3 }, // +1
    ]
    expect(byPriority(actions).map((a) => a.text)).toEqual(['quick', 'mid', 'low'])
  })

  it('does not mutate the input', () => {
    const actions = [
      { impact: 1, effort: 5 },
      { impact: 5, effort: 1 },
    ]
    byPriority(actions)
    expect(actions[0].impact).toBe(1)
  })
})
