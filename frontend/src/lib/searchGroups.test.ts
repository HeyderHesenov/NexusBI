import { describe, expect, it } from 'vitest'
import { groupHits, routeFor } from './searchGroups'
import type { SearchHit } from '../api/search'

const hit = (kind: SearchHit['kind'], id: string): SearchHit => ({
  kind,
  ref_id: id,
  title: `${kind}-${id}`,
  score: 1,
})

describe('groupHits', () => {
  it('buckets by kind in display order (dashboard → metric → saved)', () => {
    const { groups } = groupHits([hit('saved_query', 's1'), hit('dashboard', 'd1'), hit('metric_asset', 'm1')])
    expect(groups.map((g) => g.kind)).toEqual(['dashboard', 'metric_asset', 'saved_query'])
    expect(groups.map((g) => g.label)).toEqual(['Dashboard', 'Metrik', 'Hesabat'])
  })

  it('flat order matches the visual (grouped) order for keyboard nav', () => {
    const { flat } = groupHits([hit('saved_query', 's1'), hit('dashboard', 'd1'), hit('dashboard', 'd2')])
    expect(flat.map((h) => h.ref_id)).toEqual(['d1', 'd2', 's1'])
  })

  it('omits empty groups', () => {
    const { groups } = groupHits([hit('metric_asset', 'm1')])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('metric_asset')
  })

  it('appends unknown kinds under "Digər" instead of dropping them', () => {
    const weird = { kind: 'workspace', ref_id: 'w1', title: 'W', score: 1 } as unknown as SearchHit
    const { groups, flat } = groupHits([hit('dashboard', 'd1'), weird])
    expect(groups.map((g) => g.label)).toEqual(['Dashboard', 'Digər'])
    expect(flat).toHaveLength(2)
  })

  it('returns empty for no hits', () => {
    expect(groupHits([])).toEqual({ groups: [], flat: [] })
  })
})

describe('routeFor', () => {
  it('maps known kinds to their pages', () => {
    expect(routeFor('dashboard')).toBe('/dashboards')
    expect(routeFor('metric_asset')).toBe('/metrics')
    expect(routeFor('saved_query')).toBe('/reports')
  })

  it('falls back to home for an unknown kind', () => {
    expect(routeFor('mystery')).toBe('/')
  })
})
