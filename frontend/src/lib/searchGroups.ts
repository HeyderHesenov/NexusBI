import type { SearchHit } from '../api/search'

export type SearchKind = SearchHit['kind']

// Display order of result groups (and the keyboard-nav order derives from it).
export const KIND_ORDER: SearchKind[] = ['dashboard', 'metric_asset', 'saved_query']

export const KIND_LABEL: Record<SearchKind, string> = {
  dashboard: 'Dashboard',
  metric_asset: 'Metrik',
  saved_query: 'Hesabat',
}

const KIND_ROUTE: Record<SearchKind, string> = {
  dashboard: '/dashboards',
  metric_asset: '/metrics',
  saved_query: '/reports',
}

/** Where selecting a hit navigates. Unknown kinds fall back to the home console. */
export function routeFor(kind: string): string {
  return KIND_ROUTE[kind as SearchKind] ?? '/'
}

export interface SearchGroup {
  kind: SearchKind
  label: string
  hits: SearchHit[]
}

export interface GroupedSearch {
  groups: SearchGroup[]
  /** Visual (== keyboard-nav) order: groups flattened top-to-bottom. */
  flat: SearchHit[]
}

/** Bucket hits by kind in display order; unknown kinds are appended under "Digər"
 * so nothing is silently dropped. */
export function groupHits(hits: SearchHit[]): GroupedSearch {
  const groups: SearchGroup[] = []
  for (const kind of KIND_ORDER) {
    const inKind = hits.filter((h) => h.kind === kind)
    if (inKind.length) groups.push({ kind, label: KIND_LABEL[kind], hits: inKind })
  }
  const known = new Set<string>(KIND_ORDER)
  const rest = hits.filter((h) => !known.has(h.kind))
  if (rest.length) groups.push({ kind: rest[0].kind, label: 'Digər', hits: rest })

  return { groups, flat: groups.flatMap((g) => g.hits) }
}
