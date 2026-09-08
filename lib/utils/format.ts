import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '@/config/app'

/**
 * Display formatting.
 *
 * Kept in one place so a price is written the same way on a card, a product
 * page and a price chart. Formatting never rounds in a way that changes the
 * number's meaning: prices are already exact to the cent by the time they get
 * here.
 */

const currencyFormatters = new Map<string, Intl.NumberFormat>()

/**
 * Format money.
 *
 * Whole amounts drop the ".00" because it reads better on a dense product grid;
 * everything else always shows exactly two decimals, so 61.6 renders as
 * "$61.60" rather than "$61.6".
 *
 * The cache key includes that choice. It previously did not, which meant the
 * first amount formatted decided the decimal behaviour for every subsequent
 * one — a single whole price early on made every later price lose its trailing
 * zero.
 */
export function formatMoney(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  const whole = Number.isInteger(amount)
  const key = `${locale}:${currency}:${whole ? 'whole' : 'fraction'}`

  let formatter = currencyFormatters.get(key)

  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
      })
    } catch {
      // An invalid currency code must not break the page.
      formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
      })
    }
    currencyFormatters.set(key, formatter)
  }

  return formatter.format(amount)
}

/** "28% off" — rounds to a whole percent, which is all the precision that means anything. */
export function formatDiscount(fraction: number): string {
  return `${Math.round(fraction * 100)}% off`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/** Relative time in plain words: "3 days ago". */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const seconds = Math.round((now.getTime() - then) / 1000)
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ]

  const formatter = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' })

  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(seconds) >= secondsPerUnit) {
      return formatter.format(-Math.round(seconds / secondsPerUnit), unit)
    }
  }
  return 'just now'
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { dateStyle: 'medium' }).format(date)
}

/** Sentence-case a taxonomy term for display: "t-shirts" -> "T-shirts". */
export function humanize(value: string): string {
  const spaced = value.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
