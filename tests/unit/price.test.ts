import { describe, expect, it } from 'vitest'
import {
  discountFraction,
  normalizeCurrency,
  parsePrice,
  validateOriginalPrice,
  MAX_ACCEPTED_PRICE,
} from '@/services/normalization/price'

describe('parsePrice', () => {
  it('accepts plain numbers', () => {
    expect(parsePrice(45.99)).toEqual({ ok: true, amount: 45.99 })
    expect(parsePrice(0)).toEqual({ ok: true, amount: 0 })
  })

  it('strips currency symbols and codes', () => {
    expect(parsePrice('$45.99')).toEqual({ ok: true, amount: 45.99 })
    expect(parsePrice('USD 30')).toEqual({ ok: true, amount: 30 })
    expect(parsePrice('£12.50')).toEqual({ ok: true, amount: 12.5 })
    expect(parsePrice('  19.99  ')).toEqual({ ok: true, amount: 19.99 })
  })

  it('handles en-US grouping', () => {
    expect(parsePrice('1,299.00')).toEqual({ ok: true, amount: 1299 })
    expect(parsePrice('987,654.32')).toEqual({ ok: true, amount: 987654.32 })
  })

  it('handles European decimal commas', () => {
    expect(parsePrice('1.299,00')).toEqual({ ok: true, amount: 1299 })
    expect(parsePrice('1299,00')).toEqual({ ok: true, amount: 1299 })
  })

  it('treats a 3-digit comma group as grouping, not decimals', () => {
    expect(parsePrice('1,234')).toEqual({ ok: true, amount: 1234 })
  })

  it('rejects rather than guesses on unusable input', () => {
    expect(parsePrice(null).ok).toBe(false)
    expect(parsePrice(undefined).ok).toBe(false)
    expect(parsePrice('').ok).toBe(false)
    expect(parsePrice('free').ok).toBe(false)
    expect(parsePrice('call for price').ok).toBe(false)
    expect(parsePrice(-10).ok).toBe(false)
    expect(parsePrice(Number.NaN).ok).toBe(false)
    expect(parsePrice(Number.POSITIVE_INFINITY).ok).toBe(false)
    expect(parsePrice({}).ok).toBe(false)
  })

  it('rejects implausibly large values', () => {
    expect(parsePrice(MAX_ACCEPTED_PRICE + 1).ok).toBe(false)
  })

  it('rounds to exact cents', () => {
    const result = parsePrice(19.999)
    expect(result.ok && result.amount).toBe(20)
    const half = parsePrice(0.005)
    expect(half.ok && half.amount).toBe(0.01)
  })
})

describe('validateOriginalPrice', () => {
  it('keeps a genuine original price', () => {
    expect(validateOriginalPrice(50, 80)).toEqual({ original: 80 })
  })

  it('discards an original at or below the current price', () => {
    const equal = validateOriginalPrice(50, 50)
    expect(equal.original).toBeNull()
    expect(equal.warning).toBeDefined()

    const lower = validateOriginalPrice(50, 40)
    expect(lower.original).toBeNull()
    expect(lower.warning).toBeDefined()
  })

  it('discards an implausible original price', () => {
    // 50 -> 5000 is almost always a major/minor units mix-up, not a 99% sale.
    const result = validateOriginalPrice(50, 5000)
    expect(result.original).toBeNull()
    expect(result.warning).toContain('implausible')
  })

  it('passes through a null original', () => {
    expect(validateOriginalPrice(50, null)).toEqual({ original: null })
  })
})

describe('discountFraction', () => {
  it('computes the fraction off', () => {
    expect(discountFraction(75, 100)).toBe(0.25)
    expect(discountFraction(66.67, 100)).toBeCloseTo(0.3333, 4)
  })

  it('returns null when there is nothing to compare against', () => {
    expect(discountFraction(100, null)).toBeNull()
    expect(discountFraction(100, 100)).toBeNull()
    expect(discountFraction(100, 90)).toBeNull()
    expect(discountFraction(100, 0)).toBeNull()
  })
})

describe('normalizeCurrency', () => {
  it('normalises valid codes', () => {
    expect(normalizeCurrency('usd')).toBe('USD')
    expect(normalizeCurrency(' eur ')).toBe('EUR')
  })

  it('falls back when the code is missing or malformed', () => {
    expect(normalizeCurrency(undefined)).toBe('USD')
    expect(normalizeCurrency('dollars')).toBe('USD')
    expect(normalizeCurrency(123)).toBe('USD')
    expect(normalizeCurrency('', 'GBP')).toBe('GBP')
  })
})
