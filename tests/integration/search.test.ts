import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getSearchProvider } from '@/lib/search'
import { buildSearchHref, parseSearchParams } from '@/lib/search/query-params'
import type { SearchProvider } from '@/lib/search/types'
import { createTestDb, type TestDb } from '../helpers/db'

describe('search', () => {
  let context: TestDb
  let search: SearchProvider

  beforeAll(async () => {
    context = await createTestDb()
    search = getSearchProvider(context.db)
  }, 120_000)

  afterAll(async () => {
    await context?.close()
  })

  it('returns the whole buyable catalogue for an empty query', async () => {
    const result = await search.search({})
    expect(result.total).toBeGreaterThan(0)
    expect(result.items.length).toBeGreaterThan(0)

    // The default is products a user could actually buy.
    for (const item of result.items) {
      expect(['in_stock', 'low_stock']).toContain(item.offer.availability)
    }
  })

  it('matches on full text across title, brand and attributes', async () => {
    const byMaterial = await search.search({ text: 'linen' })
    expect(byMaterial.total).toBeGreaterThan(0)

    const byBrand = await search.search({ text: 'Aera' })
    expect(byBrand.total).toBeGreaterThan(0)
    expect(byBrand.items.every((item) => item.product.brand === 'Aera')).toBe(true)
  })

  it('supports natural keyword combinations', async () => {
    // websearch_to_tsquery gives users quoted phrases and `or` for free.
    const combined = await search.search({ text: 'cotton shirt' })
    expect(combined.total).toBeGreaterThanOrEqual(0)

    const either = await search.search({ text: 'linen or wool' })
    expect(either.total).toBeGreaterThan(0)
  })

  it('returns an empty result, not an error, for nonsense', async () => {
    const result = await search.search({ text: 'zzzzqqqxx' })
    expect(result.total).toBe(0)
    expect(result.items).toEqual([])
  })

  it('is not injectable through the search string', async () => {
    // If the query text were interpolated, this would drop a table.
    const hostile = await search.search({ text: "'; drop table products; --" })
    expect(hostile.items).toBeDefined()

    const stillThere = await context.db.query<{ n: number }>(
      `select count(*)::int as n from products`,
    )
    expect(stillThere[0].n).toBeGreaterThan(0)
  })

  it('filters by category', async () => {
    const result = await search.search({ filters: { category: 'shoes' } })
    expect(result.total).toBeGreaterThan(0)
    expect(result.items.every((item) => item.product.category === 'shoes')).toBe(true)
  })

  it('filters by price range', async () => {
    const result = await search.search({ filters: { minPrice: 50, maxPrice: 120 } })
    expect(result.items.length).toBeGreaterThan(0)
    for (const item of result.items) {
      expect(item.offer.currentPrice).toBeGreaterThanOrEqual(50)
      expect(item.offer.currentPrice).toBeLessThanOrEqual(120)
    }
  })

  it('filters by colour', async () => {
    const result = await search.search({ filters: { colors: ['black'] } })
    expect(result.items.every((item) => item.product.attributes.color === 'black')).toBe(true)
  })

  it('filters by minimum discount', async () => {
    const result = await search.search({ filters: { minDiscount: 25 } })
    for (const item of result.items) {
      expect(item.offer.originalPrice).not.toBeNull()
      const discount =
        ((item.offer.originalPrice! - item.offer.currentPrice) / item.offer.originalPrice!) * 100
      expect(discount).toBeGreaterThanOrEqual(24.5)
    }
  })

  it('sorts by price in both directions', async () => {
    const ascending = await search.search({ sort: 'price_asc', pageSize: 10 })
    const prices = ascending.items.map((item) => item.offer.currentPrice)
    expect([...prices].sort((a, b) => a - b)).toEqual(prices)

    const descending = await search.search({ sort: 'price_desc', pageSize: 10 })
    const reverse = descending.items.map((item) => item.offer.currentPrice)
    expect([...reverse].sort((a, b) => b - a)).toEqual(reverse)
  })

  it('sorts by the real deal score, not a discount proxy', async () => {
    const result = await search.search({ sort: 'deal_score', pageSize: 12 })
    const scores = result.items.map((item) => item.deal.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('paginates without repeating or losing products', async () => {
    const first = await search.search({ sort: 'price_asc', page: 1, pageSize: 5 })
    const second = await search.search({ sort: 'price_asc', page: 2, pageSize: 5 })

    expect(first.items).toHaveLength(5)
    expect(first.total).toBe(second.total)

    const firstIds = first.items.map((i) => i.product.id)
    const secondIds = second.items.map((i) => i.product.id)
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([])
  })

  it('caps the page size so a request cannot ask for the whole catalogue', async () => {
    const result = await search.search({ pageSize: 10_000 })
    expect(result.pageSize).toBeLessThanOrEqual(60)
  })

  it('returns facet counts consistent with the filtered set', async () => {
    const result = await search.search({ filters: { category: 'clothing' } })

    expect(result.facets.brands.length).toBeGreaterThan(0)
    const total = result.facets.categories.reduce((sum, facet) => sum + facet.count, 0)
    expect(total).toBe(result.total)

    for (const facet of result.facets.brands) {
      expect(facet.count).toBeGreaterThan(0)
    }
  })

  it('reports price bounds for the filtered set', async () => {
    const result = await search.search({ filters: { category: 'shoes' } })
    expect(result.priceBounds).not.toBeNull()
    expect(result.priceBounds!.min).toBeLessThanOrEqual(result.priceBounds!.max)
  })

  it('suggests brands and titles', async () => {
    const suggestions = await search.suggest('Aer')
    expect(suggestions.some((s) => s.toLowerCase().includes('aer'))).toBe(true)

    // Too short to be useful; avoids scanning on every keystroke.
    expect(await search.suggest('a')).toEqual([])
  })
})

describe('search parameter parsing', () => {
  it('reads a well-formed query string', () => {
    const query = parseSearchParams({
      q: 'linen shirt',
      category: 'clothing',
      color: 'olive,navy',
      min: '50',
      max: '200',
      sort: 'price_asc',
      page: '2',
    })

    expect(query.text).toBe('linen shirt')
    expect(query.filters?.category).toBe('clothing')
    expect(query.filters?.colors).toEqual(['olive', 'navy'])
    expect(query.filters?.minPrice).toBe(50)
    expect(query.sort).toBe('price_asc')
    expect(query.page).toBe(2)
  })

  it('drops invalid values instead of failing the request', () => {
    const query = parseSearchParams({
      category: 'not-a-category',
      color: 'chartreuse',
      min: 'abc',
      sort: 'random',
      page: '-5',
    })

    expect(query.filters?.category).toBeUndefined()
    expect(query.filters?.colors).toBeUndefined()
    expect(query.filters?.minPrice).toBeUndefined()
    expect(query.sort).toBe('relevance')
    expect(query.page).toBe(1)
  })

  it('round-trips through a href', () => {
    const original = parseSearchParams({ q: 'linen', category: 'clothing', color: 'olive' })
    const href = buildSearchHref(original)
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams)

    expect(parseSearchParams(params).filters?.colors).toEqual(['olive'])
    expect(parseSearchParams(params).text).toBe('linen')
  })
})
