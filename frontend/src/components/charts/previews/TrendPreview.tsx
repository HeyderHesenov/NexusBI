import type { ChartConfig } from '../../../types'
import { Sparkline } from '../Sparkline'
import { pickSeries, type Row } from './previewData'

/** Line/area collapse to their shape: a fluid-width Sparkline. `pickSeries` (not
 *  deriveKpiSeries) so a categorical x-axis still draws — see previewData.ts.
 *  Assumes 2+ points — ChartPreview guards that. */
export function TrendPreview({ data, config }: { data: Row[]; config: ChartConfig }) {
  const points = pickSeries(data, config)
  return (
    <div className="h-20 w-full">
      <Sparkline points={points} width={240} height={72} responsive />
    </div>
  )
}
