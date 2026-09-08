import { round2, round4 } from '@/lib/utils/number'

/**
 * Price parsing and sanity checks.
 *
 * Merchant feeds express money inconsistently: "1,299.00", "$45.99", "45,99",
 * "USD 30", 30, "free". Getting this wrong produces a false discount claim,
 * which is the single most damaging thing Bloom could show a user — so parsing
 * is strict and refuses anything ambiguous rather than guessing.
 *
 * No language model is ever involved in any function in this file.
 */

/** Highest price Bloom will accept from a feed. Above this, assume bad data. */
export const MAX_ACCEPTED_PRICE = 1_000_000

export type ParsedMoney = { ok: true; amount: number } | { ok: false; reason: string }

/**
 * Parse a feed price into an exact 2dp number.
 *
 * Deliberately rejects, rather than coerces:
 *   - negative values
 *   - non-finite values
 *   - values above MAX_ACCEPTED_PRICE
 *   - strings with no digits, or with ambiguous separators
 */
export function parsePrice(input: unknown): ParsedMoney {
  if (input === null || input === undefined || input === '') {
    return { ok: false, reason: 'missing' }
  }

  if (typeof input === 'number') {
    return validateAmount(input)
  }

  if (typeof input !== 'string') {
    return { ok: false, reason: `unsupported type ${typeof input}` }
  }

  // Strip currency symbols, codes and whitespace, keep digits and separators.
  const cleaned = input
    .trim()
    .replace(/[\p{Sc}]/gu, '')
    .replace(/\b[A-Z]{3}\b/g, '')
    .replace(/\s/g, '')

  if (!/\d/.test(cleaned)) return { ok: false, reason: 'no digits' }
  if (!/^-?[\d.,]+$/.test(cleaned)) return { ok: false, reason: 'unexpected characters' }

  const normalized = normalizeSeparators(cleaned)
  if (normalized === null) return { ok: false, reason: 'ambiguous decimal separator' }

  const value = Number(normalized)
  if (!Number.isFinite(value)) return { ok: false, reason: 'not a number' }

  return validateAmount(value)
}

/**
 * Resolve `,` and `.` into a plain decimal string.
 *
 * Handles the three common conventions: "1,299.00" (en), "1.299,00" (de),
 * "1299,00" (fr). Returns null when the intent genuinely cannot be determined,
 * e.g. "1,234" which is 1234 in en-US and 1.234 in de-DE.
 */
function normalizeSeparators(value: string): string | null {
  const hasComma = value.includes(',')
  const hasDot = value.includes('.')

  if (hasComma && hasDot) {
    // The rightmost separator is the decimal one.
    return value.lastIndexOf(',') > value.lastIndexOf('.')
      ? value.replace(/\./g, '').replace(',', '.')
      : value.replace(/,/g, '')
  }

  if (hasComma) {
    const parts = value.split(',')
    if (parts.length > 2) return value.replace(/,/g, '') // 1,234,567 -> grouping
    const decimals = parts[1] ?? ''
    // Exactly 2 decimals reads as a decimal comma; exactly 3 reads as grouping.
    if (decimals.length === 2) return value.replace(',', '.')
    if (decimals.length === 3) return value.replace(',', '')
    if (decimals.length === 0) return value.replace(',', '')
    return null
  }

  if (hasDot) {
    const parts = value.split('.')
    if (parts.length > 2) return value.replace(/\./g, '')
    // "1.234" is ambiguous, but a plain dot is overwhelmingly a decimal point in
    // feed data, and treating it as grouping would inflate prices 1000x.
    return value
  }

  return value
}

function validateAmount(value: number): ParsedMoney {
  if (!Number.isFinite(value)) return { ok: false, reason: 'not finite' }
  if (value < 0) return { ok: false, reason: 'negative' }
  if (value > MAX_ACCEPTED_PRICE) return { ok: false, reason: 'implausibly large' }
  return { ok: true, amount: round2(value) }
}

/**
 * Decide whether a merchant's "original price" can be trusted.
 *
 * An original at or below the current price is not a discount, it is bad data.
 * Rejecting it here is why the UI never shows a fabricated strike-through.
 */
export function validateOriginalPrice(
  current: number,
  original: number | null,
): { original: number | null; warning?: string } {
  if (original === null) return { original: null }

  if (original <= current) {
    return {
      original: null,
      warning: `original price ${original} is not above current price ${current}; discarded`,
    }
  }

  // A "was" price more than 20x the current price is implausible and is usually
  // a units error (e.g. minor units mixed with major units).
  if (original > current * 20) {
    return {
      original: null,
      warning: `original price ${original} implausible against current ${current}; discarded`,
    }
  }

  return { original: round2(original) }
}

/** Discount as a fraction of the original price, 0-1, or null when unknowable. */
export function discountFraction(current: number, original: number | null): number | null {
  if (original === null || original <= 0 || original <= current) return null
  return round4((original - current) / original)
}

/** ISO-4217 currency code, upper-cased, defaulting when absent or malformed. */
export function normalizeCurrency(input: unknown, fallback = 'USD'): string {
  if (typeof input !== 'string') return fallback
  const code = input.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : fallback
}
