import { useCallback } from 'react'
import { useLocaleStore } from '../store/localeStore'
import { formatNumber, localeFor, type FormatNumberOptions } from '../lib/format'

/** React hook: returns a number formatter bound to the current app language, so
 *  every chart/widget renders numbers for the SAME locale the user selected.
 *  Callers only pass compact/currency/decimals — the locale is filled in. */
export function useFormatNumber() {
  const lang = useLocaleStore((s) => s.lang)
  return useCallback(
    (value: number, opts: Omit<FormatNumberOptions, 'locale'> = {}) =>
      formatNumber(value, { ...opts, locale: localeFor(lang) }),
    [lang],
  )
}
