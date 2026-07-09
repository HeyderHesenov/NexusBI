import { useCallback } from 'react'
import type { ChartConfig } from '../types'
import { appendUnit } from '../lib/format'
import { useFormatNumber } from './useFormatNumber'

/** One value formatter for every chart surface (ticks, tooltips, bar labels):
 *  honors the backend's ChartConfig.format hint on top of useFormatNumber.
 *  Under `compact` the format's `decimals` cap is ignored — a cap of 0 would
 *  collapse adjacent ticks to the same label ("1K", "1K", "2K"). */
export function useChartValueFormatter(format: ChartConfig['format']) {
  const fmtNum = useFormatNumber()
  const currency = format?.currency ?? undefined
  const decimals = format?.decimals ?? undefined
  const unit = format?.unit
  return useCallback(
    (v: number, opts: { compact?: boolean } = {}) => {
      const compact = opts.compact ?? true
      return appendUnit(
        fmtNum(v, { compact, currency, decimals: compact ? undefined : decimals }),
        unit,
      )
    },
    [fmtNum, currency, decimals, unit],
  )
}
