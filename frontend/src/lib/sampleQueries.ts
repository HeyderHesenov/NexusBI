import type { DataSourceSchema } from '../types'

const NUMERIC = /(int|float|double|decimal|numeric|real|money|bigint)/i
const DATE = /(date|time|timestamp|year)/i

/** Build schema-aware NL example prompts (rule-based — no AI cost). */
export function buildSamples(schema: DataSourceSchema, max = 6): string[] {
  const out: string[] = []
  for (const [table, cols] of Object.entries(schema)) {
    const numeric = cols.filter((c) => NUMERIC.test(c.type)).map((c) => c.name)
    const dates = cols.filter((c) => DATE.test(c.type)).map((c) => c.name)
    const categorical = cols
      .filter((c) => !NUMERIC.test(c.type) && !DATE.test(c.type))
      .map((c) => c.name)

    if (numeric[0] && categorical[0]) {
      out.push(`${categorical[0]} üzrə ${numeric[0]} cəmi`)
      out.push(`${table}: ${numeric[0]} üzrə top 10`)
    } else if (categorical[0]) {
      out.push(`${categorical[0]} üzrə ${table} sayı`)
    }
    if (numeric[0] && dates[0]) {
      out.push(`${dates[0]} üzrə ${numeric[0]} trendi`)
    }
    if (out.length >= max) break
  }
  return out.slice(0, max)
}
