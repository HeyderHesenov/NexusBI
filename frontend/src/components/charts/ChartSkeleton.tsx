/** Placeholder shown while the (lazy) chart bundle loads. Mirrors the chart's
 *  sized box so layout doesn't jump when recharts arrives. */
export function ChartSkeleton({ height = 320 }: { height?: number | string }) {
  return (
    <div
      className="plot-grid w-full animate-pulse rounded-2xl border border-line bg-surface-2"
      style={{ height: typeof height === 'number' ? `${height}px` : height, minHeight: 120 }}
      aria-hidden
    />
  )
}
