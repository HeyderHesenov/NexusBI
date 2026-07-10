import { useCallback } from 'react'
import { useLocaleStore } from '../store/localeStore'
import { formatDate, localeFor, type FormatDateOptions } from '../lib/format'

/** React hook: returns a date/time formatter bound to the current app language,
 *  so every timestamp renders for the SAME locale the user selected instead of a
 *  hardcoded 'az-AZ'. Callers only pass `mode` — the locale is filled in. */
export function useFormatDate() {
  const lang = useLocaleStore((s) => s.lang)
  return useCallback(
    (value: string | number | Date, opts: Omit<FormatDateOptions, 'locale'> = {}) =>
      formatDate(value, { ...opts, locale: localeFor(lang) }),
    [lang],
  )
}
