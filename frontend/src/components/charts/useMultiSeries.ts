import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChartConfig } from '../../types'
import { pivotSeries, type SeriesPivot } from '../../lib/series'
import { SERIES } from './theme'

/** Multi-series pivot for line/area widgets: active when config.color_by
 *  names a third column. Series cap = the fixed SERIES palette length so hues
 *  are never cycled; overflow folds into a localized "others" bucket. */
export function useMultiSeries(
  data: Record<string, unknown>[],
  x: string,
  y: string,
  config: ChartConfig,
): SeriesPivot | null {
  const { t } = useTranslation()
  const colorBy = config.color_by
  return useMemo(
    () =>
      colorBy && colorBy !== x && colorBy !== y
        ? pivotSeries(data, x, y, colorBy, SERIES.length, t('chart.others'))
        : null,
    [data, x, y, colorBy, t],
  )
}
