import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  loadCandidateProductIds,
  loadProductDetail,
  loadProductSummaries,
} from '@/lib/products/repository'
import { createTestDb, TEST_NOW, type TestDb } from '../helpers/db'

/**
 * Catalogue integration tests.
 *
 * These run the real ingestion pipeline into a real PostgreSQL, then query it
 * through the real repository. They are the check that the schema, the SQL and
 * the domain mapping actually agree with each other.
 */
describe('catalogue', () => {
  let context: TestDb

  beforeAll(async () => {
    context = await createTestDb()
  }, 120_000)

  afterAll(async () => {
    await context?.close()
  })

  it('ingests the seed catalogue into canonical products with listings', async () => {
    const counts = await context.db.query<{
      merchants: number
      products: number
      listings: number
      prices: number
    }>(
      `select (select count(*)::int from merchants) as merchants,
              (select count(*)::int from products) as products,
              (select count(*)::int from merchant_products) as listings,
              (select count(*)::int from price_history) as prices`,
    )

    const row = counts[0]
    expect(row.merchants).toBe(3)
    expect(row.products).toBeGreaterThan(30)
    expect(row.listings).toBeGreaterThan(row.products)
    expect(row.prices).toBeGreaterThan(1000)
  })

  it('never merges more listings into a product than there are merchants', async () => {
    // The over-merge guard: with three merchants, four listings on one canonical
    // product means product identity collapsed two different products.
    const rows = await context.db.query<{ product_id: string; n: number }>(
      `select product_id, count(*)::int as n
         from merchant_products group by product_id having count(*) > 3`,
    )
    expect(rows).toEqual([])
  })

  it('gives each canonical product a distinct match key', async () => {
    const rows = await context.db.query<{ n: number }>(
      `select count(*)::int as n from (
         select match_key from products group by match_key having count(*) > 1
       ) duplicated`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('records no listing whose original price undercuts its current price', async () => {
    const rows = await context.db.query<{ n: number }>(
      `select count(*)::int as n from merchant_products
        where original_price is not null and original_price < current_price`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('assembles product summaries with a best offer and a deal assessment', async () => {
    const ids = await loadCandidateProductIds(context.db, { limit: 5 })
    expect(ids.length).toBe(5)

    const summaries = await loadProductSummaries(context.db, ids, { now: TEST_NOW })
    expect(summaries.length).toBeGreaterThan(0)

    for (const summary of summaries) {
      expect(summary.product.brand).toBeTruthy()
      expect(summary.product.canonicalTitle).toBeTruthy()

      // Prices must be numbers, not the strings Postgres returns for `numeric`.
      expect(typeof summary.offer.currentPrice).toBe('number')
      expect(Number.isFinite(summary.offer.currentPrice)).toBe(true)
      expect(summary.offer.currentPrice).toBeGreaterThan(0)

      expect(summary.deal.score).toBeGreaterThanOrEqual(0)
      expect(summary.deal.score).toBeLessThanOrEqual(100)
      expect(summary.deal.reasons.length).toBeGreaterThan(0)
      expect(summary.offerCount).toBeGreaterThanOrEqual(1)
    }
  })

  it('preserves the caller-supplied ordering', async () => {
    const ids = await loadCandidateProductIds(context.db, { limit: 8 })
    const reversed = [...ids].reverse()

    const summaries = await loadProductSummaries(context.db, reversed, { now: TEST_NOW })
    const returned = summaries.map((s) => s.product.id)

    expect(returned).toEqual(reversed.filter((id) => returned.includes(id)))
  })

  it('picks the cheapest buyable listing as the headline offer', async () => {
    const ids = await loadCandidateProductIds(context.db, { limit: 30 })
    const summaries = await loadProductSummaries(context.db, ids, { now: TEST_NOW })

    const multiOffer = summaries.find((s) => s.offerCount > 1)
    expect(multiOffer).toBeDefined()

    const detail = await loadProductDetail(context.db, multiOffer!.product.id, { now: TEST_NOW })
    expect(detail).not.toBeNull()

    const buyable = detail!.offers.filter((o) => ['in_stock', 'low_stock'].includes(o.availability))
    if (buyable.length > 0) {
      const cheapest = Math.min(...buyable.map((o) => o.currentPrice))
      expect(detail!.offer.currentPrice).toBe(cheapest)
      expect(['in_stock', 'low_stock']).toContain(detail!.offer.availability)
    }
  })

  it('loads full product detail with offers, variants and price history', async () => {
    const ids = await loadCandidateProductIds(context.db, { limit: 1 })
    const detail = await loadProductDetail(context.db, ids[0], { now: TEST_NOW })

    expect(detail).not.toBeNull()
    expect(detail!.offers.length).toBeGreaterThanOrEqual(1)
    expect(detail!.priceHistory.length).toBeGreaterThan(0)

    for (const point of detail!.priceHistory) {
      expect(typeof point.price).toBe('number')
      expect(point.price).toBeGreaterThan(0)
    }

    // History must be chronological — the deal engine's windows depend on it.
    const times = detail!.priceHistory.map((p) => new Date(p.recordedAt).getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('returns null for a product that does not exist', async () => {
    const detail = await loadProductDetail(context.db, '00000000-0000-0000-0000-000000000000', {
      now: TEST_NOW,
    })
    expect(detail).toBeNull()
  })

  it('is idempotent: re-seeding does not duplicate anything', async () => {
    const before = await context.db.query<{ p: number; l: number; h: number }>(
      `select (select count(*)::int from products) p,
              (select count(*)::int from merchant_products) l,
              (select count(*)::int from price_history) h`,
    )

    const { seedDatabase } = await import('@/services/ingestion/seed-runner')
    await seedDatabase(context.db, { now: TEST_NOW })

    const after = await context.db.query<{ p: number; l: number; h: number }>(
      `select (select count(*)::int from products) p,
              (select count(*)::int from merchant_products) l,
              (select count(*)::int from price_history) h`,
    )

    expect(after[0].p).toBe(before[0].p)
    expect(after[0].l).toBe(before[0].l)
    expect(after[0].h).toBe(before[0].h)
  }, 120_000)
})
