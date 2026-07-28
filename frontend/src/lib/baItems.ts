/**
 * Normalisers for BA Studio framework content.
 *
 * Artifacts saved before the evidence layer hold bare strings in their SWOT
 * buckets and carry no `facts`, so every reader goes through here rather than
 * indexing a bucket directly — an old artifact must render exactly as well as a
 * new one, just without chips.
 */
import type { BAFact, BAItem } from '../types'

/** Coerce a bucket of unknown vintage into items. Unusable entries are dropped. */
export function toItems(v: unknown): BAItem[] {
  if (!Array.isArray(v)) return []
  const out: BAItem[] = []
  for (const raw of v) {
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (text) out.push({ text, evidence: [], derived: false })
      continue
    }
    if (raw && typeof raw === 'object') {
      const o = raw as Partial<BAItem>
      const text = typeof o.text === 'string' ? o.text.trim() : ''
      if (!text) continue
      out.push({
        text,
        evidence: Array.isArray(o.evidence) ? o.evidence.filter((e) => typeof e === 'string') : [],
        derived: o.derived === true,
      })
    }
  }
  return out
}

export function factMap(facts?: BAFact[]): Map<string, BAFact> {
  const map = new Map<string, BAFact>()
  for (const f of facts ?? []) if (f?.id) map.set(f.id, f)
  return map
}

/** The facts an item actually cites. Ids with no matching fact are skipped. */
export function resolveEvidence(item: BAItem, facts: Map<string, BAFact>): BAFact[] {
  const out: BAFact[] = []
  for (const id of item.evidence) {
    const f = facts.get(id)
    if (f) out.push(f)
  }
  return out
}

/** Impact-minus-effort, descending — the order a prioritised list should read in. */
export function byPriority<T extends { impact: number; effort: number }>(actions: T[]): T[] {
  return [...actions].sort((a, b) => b.impact - b.effort - (a.impact - a.effort))
}
