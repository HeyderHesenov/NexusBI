import type { Lang } from '../i18n'

/** App language code → BCP-47 locale for Intl.NumberFormat. One place so every
 *  widget formats numbers for the SAME locale the user picked. */
const LOCALE_BY_LANG: Record<Lang, string> = {
  az: 'az-AZ',
  en: 'en-US',
  ru: 'ru-RU',
  tr: 'tr-TR',
}

export const localeFor = (lang: Lang): string => LOCALE_BY_LANG[lang] ?? 'az-AZ'

export interface FormatNumberOptions {
  /** BCP-47 locale; defaults to 'az-AZ'. React code should pass the current
   *  locale (see useFormatNumber); lib-level callers get the default. */
  locale?: string
  /** ISO 4217 code (e.g. 'USD') → currency styling. */
  currency?: string
  /** MAXIMUM fraction digits (integers stay whole — no forced trailing zeros).
   *  Defaults to 2. */
  decimals?: number
  /** Abbreviate large values: 1234 → "1.2K". */
  compact?: boolean
}

/** Single number formatter for the whole app — locale + compact + currency +
 *  decimals in one place. `decimals` is a MAXIMUM, so integers never gain
 *  spurious trailing zeros. Non-finite input renders as an em dash. */
export const formatNumber = (value: number, opts: FormatNumberOptions = {}): string => {
  if (!Number.isFinite(value)) return '—'
  const { locale = 'az-AZ', currency, decimals, compact } = opts
  const config: Intl.NumberFormatOptions = {}
  if (currency) {
    config.style = 'currency'
    config.currency = currency
  }
  if (compact) config.notation = 'compact'
  config.maximumFractionDigits = decimals ?? (compact ? 1 : 2)
  return new Intl.NumberFormat(locale, config).format(value)
}

export interface FormatDateOptions {
  /** BCP-47 locale; defaults to 'az-AZ'. React code should pass the current
   *  locale (see useFormatDate); lib-level callers get the default. */
  locale?: string
  /** 'datetime' (default) → date + HH:mm; 'date' → date only; 'short' → the
   *  compact numeric date+time used by audit/notification logs; 'time' → HH:mm
   *  only (chat bubbles). */
  mode?: 'datetime' | 'date' | 'short' | 'time'
}

const DATE_CONFIG: Record<NonNullable<FormatDateOptions['mode']>, Intl.DateTimeFormatOptions> = {
  datetime: { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' },
  date: { year: 'numeric', month: 'short', day: '2-digit' },
  short: { dateStyle: 'short', timeStyle: 'short' },
  time: { hour: '2-digit', minute: '2-digit' },
}

/** ISO date-time with no timezone designator — what the API emits whenever the
 *  value came back from SQLite, which hands back naive datetimes even for a
 *  `DateTime(timezone=True)` column (see backend core/timeutil.py). */
const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

/** Parse a backend timestamp as the UTC instant it actually is.
 *
 *  Per ES2015 a date-time string WITHOUT an offset is parsed as LOCAL time, so
 *  `new Date('2026-01-10T09:00:00')` reads 09:00 in the viewer's zone for a
 *  value the backend stored as 09:00 UTC — a silent error equal to the viewer's
 *  offset, and one that never shows up on a Postgres deployment because that
 *  driver round-trips the offset. The backend stores UTC everywhere, so the
 *  missing designator is the only thing to restore. */
export const parseInstant = (value: string | number | Date): Date =>
  typeof value === 'string' && NAIVE_ISO.test(value.trim())
    ? new Date(`${value.trim().replace(' ', 'T')}Z`)
    : value instanceof Date
      ? value
      : new Date(value)

/** Single date/time formatter for the whole app — locale-aware via the same
 *  lang→locale map as numbers, so timestamps localize with the picked language
 *  instead of a hardcoded 'az-AZ'. Invalid/empty input renders as an em dash. */
export const formatDate = (value: string | number | Date, opts: FormatDateOptions = {}): string => {
  const { locale = 'az-AZ', mode = 'datetime' } = opts
  const d = parseInstant(value)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, DATE_CONFIG[mode]).format(d)
}

export const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/** Chat-style day bucketing for separators and rail timestamps. */
export const dayBucket = (d: Date, now = new Date()): 'today' | 'yesterday' | 'other' => {
  if (isSameDay(d, now)) return 'today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  return isSameDay(d, yesterday) ? 'yesterday' : 'other'
}

/** Shared KPI number formatter — keep the metric-tree editor and the Digital Twin
 * showing the exact same string for the exact same value. Built on formatNumber
 * so it shares one locale; ≥1000 rounds to 1 decimal (as before). */
export const formatMetricValue = (n: number): string =>
  Math.abs(n) >= 1000 ? formatNumber(n, { decimals: 1 }) : String(Math.round(n * 100) / 100)

/** Signed percent to one decimal, e.g. 12.34 → "+12.3%", −5 → "-5%". */
export const formatSignedPct = (n: number): string => {
  const r = Math.round(n * 10) / 10
  return `${r >= 0 ? '+' : ''}${r}%`
}

/** Shared SVG-label ellipsis (charts have no CSS text-overflow). */
export const truncateLabel = (s: string, max = 18): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s

/** Append a chart-format unit suffix: "%" hugs the number, words get a space. */
export const appendUnit = (s: string, unit?: string | null): string =>
  !unit ? s : unit === '%' ? `${s}%` : `${s} ${unit}`
