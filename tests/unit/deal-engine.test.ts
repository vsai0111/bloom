import { describe, expect, it } from 'vitest'
import { assessDeal, computePriceStatistics, NEUTRAL_SCORE } from '@/lib/deals/engine'
import type { PricePoint } from '@/types/catalog'

const NOW = new Date('2026-06-01T00:00:00.000Z')

/** Build `count` observations at `price`, one per day counting back from NOW. */
function history(count: number, price: number, startDaysAgo = 1): PricePoint[] {
  return Array.from({ length: count }, (_, index) => ({
    price,
    originalPrice: null,
    recordedAt: new Date(NOW.getTime() - (startDaysAgo + index) * 86_400_000).toISOString(),
    source: 'seed',
  }))
}

describe('computePriceStatistics', () => {
  it('reports no statistics when there is no history', () => {
    const stats = computePriceStatistics({
      currentPrice: 100,
      originalPrice: null,
      currency: 'USD',
      history: [],
      now: NOW,
    })

    expect(stats.observationCount).toBe(0)
    expect(stats.average30Day).toBeNull()
    expect(stats.average90Day).toBeNull()
    expect(stats.historicalLow).toBeNull()
    expect(stats.pricePercentile).toBeNull()
  })

  it('withholds an average until there are enough observations', () => {
    const stats = computePriceStatistics({
      currentPrice: 80,
      originalPrice: null,
      currency: 'USD',
      history: history(2, 100),
      now: NOW,
    })

    // Two observations is not enough to call something a "typical price".
    expect(stats.observationCount).toBe(2)
    expect(stats.average30Day).toBeNull()
  })

  it('computes windowed averages, low, high and percentile', () => {
    const points: PricePoint[] = [
      ...history(3, 100, 1), // within 30 days
      ...history(3, 60, 40), // within 90 days only
    ]

    const stats = computePriceStatistics({
      currentPrice: 80,
      originalPrice: 120,
      currency: 'USD',
      history: points,
      now: NOW,
    })

    expect(stats.average30Day).toBe(100)
    expect(stats.average90Day).toBe(80) // mean of three 100s and three 60s
    expect(stats.historicalLow).toBe(60)
    expect(stats.historicalHigh).toBe(100)
    expect(stats.pricePercentile).toBeCloseTo(0.5, 4) // 80 sits midway between 60 and 100
    expect(stats.discountFraction).toBeCloseTo(0.3333, 4)
  })

  it('ignores unusable observations rather than skewing the result', () => {
    const points = [
      ...history(3, 100),
      { price: Number.NaN, originalPrice: null, recordedAt: NOW.toISOString(), source: 'seed' },
      { price: -5, originalPrice: null, recordedAt: NOW.toISOString(), source: 'seed' },
    ] as PricePoint[]

    const stats = computePriceStatistics({
      currentPrice: 100,
      originalPrice: null,
      currency: 'USD',
      history: points,
      now: NOW,
    })

    expect(stats.observationCount).toBe(3)
    expect(stats.historicalLow).toBe(100)
  })

  it('treats a never-moving price as sitting at its low', () => {
    const stats = computePriceStatistics({
      currentPrice: 100,
      originalPrice: null,
      currency: 'USD',
      history: history(5, 100),
      now: NOW,
    })

    expect(stats.pricePercentile).toBe(0)
  })
})

describe('assessDeal', () => {
  it('returns a neutral, explicitly-flagged score with no evidence', () => {
    const deal = assessDeal({
      currentPrice: 100,
      originalPrice: null,
      currency: 'USD',
      history: [],
      now: NOW,
    })

    expect(deal.score).toBe(NEUTRAL_SCORE)
    expect(deal.limitedEvidence).toBe(true)
    expect(deal.reasons.map((r) => r.code)).toContain('insufficient_history')
  })

  it('never fabricates history it does not have', () => {
    const deal = assessDeal({
      currentPrice: 100,
      originalPrice: null,
      currency: 'USD',
      history: [],
      now: NOW,
    })

    expect(deal.statistics.average30Day).toBeNull()
    expect(deal.statistics.historicalLow).toBeNull()
    for (const reason of deal.reasons) {
      expect(reason.code).not.toBe('near_historical_low')
      expect(reason.code).not.toBe('below_recent_typical')
    }
  })

  it('scores a deep discount at a historical low highly', () => {
    const deal = assessDeal({
      currentPrice: 50,
      originalPrice: 125,
      currency: 'USD',
      history: [...history(4, 120, 1), ...history(4, 100, 30)],
      now: NOW,
    })

    expect(deal.score).toBeGreaterThanOrEqual(75)
    expect(['great', 'excellent']).toContain(deal.band)
    expect(deal.limitedEvidence).toBe(false)

    const codes = deal.reasons.map((r) => r.code)
    expect(codes).toContain('discount_vs_original')
    expect(codes).toContain('below_recent_typical')
    expect(codes).toContain('at_historical_low')
  })

  it('scores a price above its recent typical poorly and says so', () => {
    const deal = assessDeal({
      currentPrice: 130,
      originalPrice: null,
      currency: 'USD',
      history: history(6, 100),
      now: NOW,
    })

    expect(deal.score).toBeLessThan(50)
    const above = deal.reasons.find((r) => r.code === 'above_recent_typical')
    expect(above).toBeDefined()
    expect(above?.sentiment).toBe('negative')
  })

  it('renormalises weights when only discount evidence exists', () => {
    const deal = assessDeal({
      currentPrice: 40,
      originalPrice: 100,
      currency: 'USD',
      history: [],
      now: NOW,
    })

    // 60% off saturates the discount component, so with it as the only
    // available evidence the score should be at the top of the range.
    expect(deal.score).toBe(100)
    // ...but the thin history must still be disclosed.
    expect(deal.limitedEvidence).toBe(true)
    expect(deal.reasons.map((r) => r.code)).toContain('insufficient_history')
  })

  it('is deterministic', () => {
    const input = {
      currentPrice: 72.5,
      originalPrice: 110,
      currency: 'USD',
      history: history(8, 95),
      now: NOW,
    }
    const first = assessDeal(input)
    const second = assessDeal(input)
    expect(first).toEqual(second)
  })

  it('maps scores onto the configured bands', () => {
    const deal = assessDeal({
      currentPrice: 100,
      originalPrice: null,
      currency: 'USD',
      history: history(5, 100),
      now: NOW,
    })
    expect(deal.band).toBeDefined()
    expect(deal.bandLabel).toBeTruthy()
    expect(deal.score).toBeGreaterThanOrEqual(0)
    expect(deal.score).toBeLessThanOrEqual(100)
  })
})
