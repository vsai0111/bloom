import { describe, expect, it } from 'vitest'
import {
  availabilityScore,
  brandAffinityScore,
  categoryRelevanceScore,
  dealQualityScore,
  preferenceMatchScore,
  priceFitScore,
  scoreProduct,
} from '@/lib/recommendations/scoring'
import { diversify } from '@/lib/recommendations/diversity'
import { RECOMMENDATION_WEIGHTS } from '@/config/scoring'
import type { ProductSummary, RecommendedProduct } from '@/types/discovery'
import type { UserPreference } from '@/types/user'

/** Minimal but complete product summary, overridable per test. */
function summary(overrides: {
  brand?: string
  category?: string
  subcategory?: string | null
  attributes?: Record<string, string>
  price?: number
  availability?: string
  dealScore?: number
  id?: string
}): ProductSummary {
  return {
    product: {
      id: overrides.id ?? '11111111-1111-1111-1111-111111111111',
      canonicalTitle: 'Test Product',
      description: null,
      brand: overrides.brand ?? 'Aera',
      category: (overrides.category ?? 'clothing') as ProductSummary['product']['category'],
      subcategory: overrides.subcategory === undefined ? 't-shirts' : overrides.subcategory,
      gender: null,
      attributes: overrides.attributes ?? { color: 'olive', fit: 'boxy' },
      matchKey: 'title:aera:test',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    offer: {
      id: 'offer-1',
      merchantId: 'merchant-1',
      productId: overrides.id ?? '11111111-1111-1111-1111-111111111111',
      externalProductId: 'X1',
      title: 'Test Product',
      productUrl: 'https://example.test/p/1',
      affiliateUrl: null,
      imageUrl: null,
      availability: (overrides.availability ??
        'in_stock') as ProductSummary['offer']['availability'],
      currentPrice: overrides.price ?? 80,
      originalPrice: null,
      currency: 'USD',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      merchantName: 'Test Merchant',
      merchantSlug: 'test-merchant',
    },
    offerCount: 1,
    imageUrl: null,
    deal: {
      score: overrides.dealScore ?? 50,
      band: 'fair',
      bandLabel: 'Fair',
      reasons: [],
      limitedEvidence: false,
      statistics: {
        currentPrice: overrides.price ?? 80,
        originalPrice: null,
        currency: 'USD',
        discountFraction: null,
        average30Day: null,
        average90Day: null,
        historicalLow: null,
        historicalHigh: null,
        pricePercentile: null,
        observationCount: 10,
        historyDays: 90,
      },
    },
  }
}

function pref(
  attribute: string,
  value: string,
  weight = 0.8,
  category: string | null = null,
): UserPreference {
  return {
    id: `pref-${attribute}-${value}`,
    userId: 'user-1',
    category,
    attribute,
    value,
    weight,
    source: 'explicit',
    signalCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('preferenceMatchScore', () => {
  it('returns the neutral midpoint when the user has no preferences', () => {
    expect(preferenceMatchScore(summary({}), []).score).toBe(0.5)
  })

  it('scores a full match at 1', () => {
    const result = preferenceMatchScore(summary({}), [pref('color', 'olive'), pref('fit', 'boxy')])
    expect(result.score).toBe(1)
    expect(result.matches.every((m) => m.matched)).toBe(true)
  })

  it('does not penalise a product for missing one of several same-attribute options', () => {
    // Liking olive, navy and black should not make an olive product score 1/3.
    const result = preferenceMatchScore(summary({ attributes: { color: 'olive' } }), [
      pref('color', 'olive', 0.9),
      pref('color', 'navy', 0.9),
      pref('color', 'black', 0.9),
    ])
    expect(result.score).toBe(1)
  })

  it('scores a weaker match proportionally', () => {
    const result = preferenceMatchScore(summary({ attributes: { color: 'black' } }), [
      pref('color', 'olive', 1.0),
      pref('color', 'black', 0.5),
    ])
    expect(result.score).toBeCloseTo(0.5, 4)
  })

  it('ignores preferences scoped to a different category', () => {
    const headphones = summary({ category: 'electronics', attributes: {} })
    const result = preferenceMatchScore(headphones, [pref('fit', 'boxy', 0.9, 'clothing')])
    // The clothing-scoped preference does not apply, so nothing to compare.
    expect(result.score).toBe(0.5)
    expect(result.matches).toHaveLength(0)
  })

  it('matches case-insensitively', () => {
    const result = preferenceMatchScore(summary({ brand: 'AERA' }), [pref('brand', 'aera')])
    expect(result.score).toBe(1)
  })
})

describe('categoryRelevanceScore', () => {
  it('is neutral with no category preference', () => {
    expect(categoryRelevanceScore(summary({}), [])).toBe(0.5)
  })

  it('rewards a matching category', () => {
    expect(
      categoryRelevanceScore(summary({ category: 'clothing' }), [pref('category', 'clothing')]),
    ).toBe(1)
  })

  it('demotes but does not eliminate a non-matching category', () => {
    const score = categoryRelevanceScore(summary({ category: 'home' }), [
      pref('category', 'clothing'),
    ])
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.3)
  })
})

describe('priceFitScore', () => {
  it('is neutral with no budget preference', () => {
    expect(priceFitScore(summary({ price: 80 }), [])).toBe(0.5)
  })

  it('rewards the preferred band exactly', () => {
    // 80 falls in 'mid' (50-150).
    expect(priceFitScore(summary({ price: 80 }), [pref('price_band', 'mid')])).toBe(1)
  })

  it('treats cheaper-than-usual more kindly than dearer-than-usual', () => {
    const cheaper = priceFitScore(summary({ price: 20 }), [pref('price_band', 'mid')])
    const dearer = priceFitScore(summary({ price: 300 }), [pref('price_band', 'mid')])
    expect(cheaper).toBeGreaterThan(dearer)
  })
})

describe('brandAffinityScore', () => {
  it('is neutral with no brand preferences', () => {
    expect(brandAffinityScore(summary({}), [])).toBe(0.5)
  })

  it('does not punish an unfamiliar brand into irrelevance', () => {
    // Discovery of new brands has to remain possible.
    const score = brandAffinityScore(summary({ brand: 'Unknown' }), [pref('brand', 'aera')])
    expect(score).toBeGreaterThanOrEqual(0.3)
  })
})

describe('availability and deal components', () => {
  it('scores stock states in order', () => {
    expect(availabilityScore(summary({ availability: 'in_stock' }))).toBe(1)
    expect(availabilityScore(summary({ availability: 'low_stock' }))).toBe(0.8)
    expect(availabilityScore(summary({ availability: 'out_of_stock' }))).toBe(0)
  })

  it('maps the deal score onto the unit interval', () => {
    expect(dealQualityScore(summary({ dealScore: 90 }))).toBe(0.9)
  })
})

describe('scoreProduct', () => {
  it('blends components using the configured weights', () => {
    const item = summary({ dealScore: 100, availability: 'in_stock' })
    const score = scoreProduct(item, [])

    const expected =
      0.5 * RECOMMENDATION_WEIGHTS.preferenceMatch +
      0.5 * RECOMMENDATION_WEIGHTS.categoryRelevance +
      0.5 * RECOMMENDATION_WEIGHTS.priceFit +
      0.5 * RECOMMENDATION_WEIGHTS.brandAffinity +
      1.0 * RECOMMENDATION_WEIGHTS.dealQuality +
      1.0 * RECOMMENDATION_WEIGHTS.availability

    expect(score.total).toBeCloseTo(expected, 3)
  })

  it('ranks a matching product above a non-matching one', () => {
    const preferences = [pref('color', 'olive'), pref('category', 'clothing')]
    const match = scoreProduct(summary({ attributes: { color: 'olive' } }), preferences)
    const miss = scoreProduct(
      summary({ attributes: { color: 'red' }, category: 'home' }),
      preferences,
    )
    expect(match.total).toBeGreaterThan(miss.total)
  })

  it('drives an out-of-stock product down', () => {
    const inStock = scoreProduct(summary({ availability: 'in_stock' }), [])
    const outOfStock = scoreProduct(summary({ availability: 'out_of_stock' }), [])
    expect(inStock.total).toBeGreaterThan(outOfStock.total)
  })

  it('is deterministic', () => {
    const item = summary({})
    const preferences = [pref('color', 'olive')]
    expect(scoreProduct(item, preferences)).toEqual(scoreProduct(item, preferences))
  })

  it('keeps every component within the unit interval', () => {
    const score = scoreProduct(summary({ dealScore: 100, price: 5000 }), [
      pref('color', 'olive'),
      pref('price_band', 'budget'),
    ])
    for (const value of Object.values(score.components)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(score.total).toBeLessThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Diversity
// ---------------------------------------------------------------------------

function recommended(id: string, brand: string, subcategory: string): RecommendedProduct {
  const base = summary({ id, brand, subcategory })
  return {
    ...base,
    score: {
      total: 0.5,
      components: {
        preferenceMatch: 0.5,
        categoryRelevance: 0.5,
        priceFit: 0.5,
        brandAffinity: 0.5,
        dealQuality: 0.5,
        availability: 1,
      },
      matchedPreferences: [],
    },
    explanations: [],
  }
}

describe('diversify', () => {
  it('caps how many products one brand can take', () => {
    const items = Array.from({ length: 12 }, (_, i) => recommended(`id-${i}`, 'Aera', `sub-${i}`))
    const result = diversify(items, { maxPerBrand: 3 })
    expect(result).toHaveLength(3)
  })

  it('caps repetition of one subcategory', () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      recommended(`id-${i}`, `Brand${i}`, 't-shirts'),
    )
    const result = diversify(items, { maxPerSubcategory: 4 })
    expect(result).toHaveLength(4)
  })

  it('never repeats the same product', () => {
    const items = [
      recommended('same', 'Aera', 'a'),
      recommended('same', 'Nordfelt', 'b'),
      recommended('other', 'Rills', 'c'),
    ]
    const result = diversify(items)
    expect(result.map((r) => r.product.id)).toEqual(['same', 'other'])
  })

  it('spaces repeated brands apart', () => {
    const items = [
      recommended('1', 'Aera', 'a'),
      recommended('2', 'Aera', 'b'),
      recommended('3', 'Nordfelt', 'c'),
      recommended('4', 'Rills', 'd'),
    ]
    const result = diversify(items, { minBrandGap: 2, maxPerBrand: 3 })
    const brands = result.map((r) => r.product.brand)
    // The second Aera must not land immediately after the first.
    expect(brands[0]).toBe('Aera')
    expect(brands[1]).not.toBe('Aera')
  })

  it('backfills rather than returning a short feed', () => {
    const items = [
      recommended('1', 'Aera', 'a'),
      recommended('2', 'Aera', 'b'),
      recommended('3', 'Aera', 'c'),
    ]
    // Spacing alone would leave only one item; the cap still allows three.
    const result = diversify(items, { minBrandGap: 5, maxPerBrand: 3 })
    expect(result).toHaveLength(3)
  })

  it('respects the requested limit', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      recommended(`id-${i}`, `Brand${i % 10}`, `sub-${i % 6}`),
    )
    expect(diversify(items, { limit: 8 }).length).toBeLessThanOrEqual(8)
  })

  it('returns an empty list for empty input', () => {
    expect(diversify([])).toEqual([])
  })
})
