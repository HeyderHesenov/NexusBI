import type { EvaluatedNode, LeafProvenance, UnknownReason } from '../types'

/**
 * EvaluatedNode builders for the twin tests.
 *
 * Shared because an EvaluatedNode now carries provenance as well as a value, and
 * three test files spelling those eight fields by hand would drift — the point
 * of the fixtures is that a leaf's default state is a well-formed one.
 */

/** A leaf with a value the user typed. */
export const leaf = (id: string, value: number, name = id): EvaluatedNode => ({
  id,
  name,
  operator: 'add',
  value,
  manual_value: value,
  source_kind: 'manual',
  saved_query_id: null,
  value_column: null,
  agg: null,
  provenance: 'manual',
  source: null,
  measured_at: null,
  unknown_reason: null,
  incomplete: false,
  contribution_pct: null,
  children: [],
})

/** A leaf measured from a saved query — no manual_value at all. */
export const measuredLeaf = (id: string, value: number, name = id): EvaluatedNode => ({
  ...leaf(id, value, name),
  manual_value: null,
  source_kind: 'query',
  saved_query_id: `sq-${id}`,
  value_column: 'total',
  agg: 'sum',
  provenance: 'measured',
  source: `Saxlanan sorğu / total (sum)`,
  measured_at: '2026-08-04T09:00:00Z',
})

/** A leaf with no value: the state that must never render as 0. */
export const unknownLeaf = (
  id: string,
  name = id,
  unknown_reason: UnknownReason = 'empty',
): EvaluatedNode => ({
  ...leaf(id, 0, name),
  value: null,
  manual_value: null,
  provenance: 'unknown' as LeafProvenance,
  unknown_reason,
  incomplete: true,
})

/** An internal node. `incomplete` is derived from the children, as the API does. */
export const node = (
  id: string,
  operator: string,
  children: EvaluatedNode[],
  value: number | null = 0,
): EvaluatedNode => ({
  ...leaf(id, 0, id),
  value,
  manual_value: null,
  provenance: null,
  incomplete: children.some((c) => c.incomplete),
  operator,
  children,
})
