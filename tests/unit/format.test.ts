import { describe, expect, it } from 'vitest'
import { formatDiscount, formatMoney, formatPercent, humanize } from '@/lib/utils/format'

describe('formatMoney', () => {
  it('drops the decimals on whole amounts', () => {
    expect(formatMoney(39, 'USD')).toBe('$39')
  })

  it('always shows two decimals on fractional amounts', () => {
    // Regression: a shared formatter cache keyed only by locale+currency meant
    // the first (whole) amount formatted made 61.6 render as "$61.6".
    expect(formatMoney(39, 'USD')).toBe('$39')
    expect(formatMoney(61.6, 'USD')).toBe('$61.60')
    expect(formatMoney(61.65, 'USD')).toBe('$61.65')
    expect(formatMoney(155.5, 'USD')).toBe('$155.50')
  })

  it('is order-independent', () => {
    expect(formatMoney(0.5, 'USD')).toBe('$0.50')
    expect(formatMoney(100, 'USD')).toBe('$100')
    expect(formatMoney(0.5, 'USD')).toBe('$0.50')
  })

  it('falls back rather than throwing on an invalid currency', () => {
    expect(() => formatMoney(10.5, 'NOTACURRENCY')).not.toThrow()
  })

  it('handles zero', () => {
    expect(formatMoney(0, 'USD')).toBe('$0')
  })
})

describe('formatDiscount and formatPercent', () => {
  it('rounds to whole percents', () => {
    expect(formatDiscount(0.2812)).toBe('28% off')
    expect(formatPercent(0.845)).toBe('85%')
    expect(formatPercent(0)).toBe('0%')
  })
})

describe('humanize', () => {
  it('makes a taxonomy term readable', () => {
    expect(humanize('t-shirts')).toBe('T shirts')
    expect(humanize('price_band')).toBe('Price band')
    expect(humanize('olive')).toBe('Olive')
  })
})
