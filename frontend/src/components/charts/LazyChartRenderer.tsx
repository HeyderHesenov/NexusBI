import { lazy, Suspense } from 'react'
import { ChartSkeleton } from './ChartSkeleton'
import type { ChartRendererProps } from './ChartRenderer'

// recharts (~440kB) is the heaviest dependency; pulling ChartRenderer in lazily
// keeps it out of the initial route chunk so pages render (and the empty query
// state shows) before the chart bundle downloads. It arrives on first chart paint.
const Inner = lazy(() => import('./ChartRenderer').then((m) => ({ default: m.ChartRenderer })))

/** Drop-in for ChartRenderer that defers the recharts bundle behind Suspense. */
export function ChartRenderer(props: ChartRendererProps) {
  return (
    <Suspense fallback={<ChartSkeleton height={props.height} />}>
      <Inner {...props} />
    </Suspense>
  )
}
