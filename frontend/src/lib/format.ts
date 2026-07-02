/** Shared KPI number formatter — keep MetricTreePage and the Digital Twin
 * showing the exact same string for the exact same value. */
export const formatMetricValue = (n: number): string =>
  Math.abs(n) >= 1000
    ? n.toLocaleString('az-AZ', { maximumFractionDigits: 1 })
    : String(Math.round(n * 100) / 100)

/** Shared SVG-label ellipsis (charts have no CSS text-overflow). */
export const truncateLabel = (s: string, max = 18): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s
