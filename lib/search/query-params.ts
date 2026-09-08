import { z } from 'zod'
import { AVAILABILITY, CATEGORIES, COLORS, FITS } from '@/config/taxonomy'
import type { Category } from '@/config/taxonomy'
import type { SearchQuery, SearchSort } from '@/types/discovery'

/**
 * Parse and validate search parameters from a URL.
 *
 * The search page is fully server-rendered and shareable, so its entire state
 * lives in the query string — which means every value arrives as untrusted
 * user input. Anything that does not validate is dropped rather than rejected,
 * so a hand-edited or stale URL degrades to a broader search instead of an
 * error page.
 */

const SORTS: SearchSort[] = [
  'relevance',
  'price_asc',
  'price_desc',
  'discount',
  'deal_score',
  'newest',
]

/** Split a repeated or comma-separated parameter into clean values. */
function multi(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  const raw = Array.isArray(value) ? value : [value]
  return raw
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 20)
}

function only(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first.trim() ? first.trim() : undefined
}

const priceSchema = z.coerce.number().finite().min(0).max(1_000_000)
const pageSchema = z.coerce.number().int().min(1).max(500)
const discountSchema = z.coerce.number().int().min(0).max(100)

export type RawSearchParams = Record<string, string | string[] | undefined>

export function parseSearchParams(params: RawSearchParams): SearchQuery {
  const text = only(params.q)

  const category = only(params.category)
  const sortValue = only(params.sort) as SearchSort | undefined

  const inVocabulary = (values: string[], allowed: readonly string[]) =>
    values.filter((value) => allowed.includes(value))

  const minPrice = priceSchema.safeParse(only(params.min))
  const maxPrice = priceSchema.safeParse(only(params.max))
  const minDiscount = discountSchema.safeParse(only(params.discount))
  const page = pageSchema.safeParse(only(params.page))

  const brands = multi(params.brand)
  const colors = inVocabulary(multi(params.color), COLORS)
  const fits = inVocabulary(multi(params.fit), FITS)
  const sizes = multi(params.size).map((size) => size.toUpperCase())
  const availability = inVocabulary(multi(params.availability), AVAILABILITY)

  return {
    text: text && text.length <= 200 ? text : undefined,
    sort: sortValue && SORTS.includes(sortValue) ? sortValue : 'relevance',
    page: page.success ? page.data : 1,
    filters: {
      category:
        category && (CATEGORIES as readonly string[]).includes(category)
          ? (category as Category)
          : undefined,
      subcategory: only(params.subcategory),
      brands: brands.length > 0 ? brands : undefined,
      colors: colors.length > 0 ? colors : undefined,
      fits: fits.length > 0 ? fits : undefined,
      sizes: sizes.length > 0 ? sizes : undefined,
      minPrice: minPrice.success ? minPrice.data : undefined,
      maxPrice: maxPrice.success ? maxPrice.data : undefined,
      minDiscount: minDiscount.success && minDiscount.data > 0 ? minDiscount.data : undefined,
      availability:
        availability.length > 0
          ? (availability as NonNullable<SearchQuery['filters']>['availability'])
          : undefined,
    },
  }
}

/** Serialise a query back into a URL search string, for links and pagination. */
export function buildSearchHref(query: SearchQuery, overrides: Partial<SearchQuery> = {}): string {
  const merged: SearchQuery = {
    ...query,
    ...overrides,
    filters: { ...query.filters, ...overrides.filters },
  }

  const params = new URLSearchParams()
  if (merged.text) params.set('q', merged.text)
  if (merged.sort && merged.sort !== 'relevance') params.set('sort', merged.sort)
  if (merged.page && merged.page > 1) params.set('page', String(merged.page))

  const f = merged.filters ?? {}
  if (f.category) params.set('category', f.category)
  if (f.subcategory) params.set('subcategory', f.subcategory)
  if (f.brands?.length) params.set('brand', f.brands.join(','))
  if (f.colors?.length) params.set('color', f.colors.join(','))
  if (f.fits?.length) params.set('fit', f.fits.join(','))
  if (f.sizes?.length) params.set('size', f.sizes.join(','))
  if (f.minPrice !== undefined) params.set('min', String(f.minPrice))
  if (f.maxPrice !== undefined) params.set('max', String(f.maxPrice))
  if (f.minDiscount !== undefined) params.set('discount', String(f.minDiscount))

  const qs = params.toString()
  return qs ? `/search?${qs}` : '/search'
}
