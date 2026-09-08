import 'server-only'
import type { Db } from '@/lib/db/types'
import { isoDate, json, num, numOrNull, str, strOrNull } from '@/lib/db/rows'
import { assessDeal } from '@/lib/deals/engine'
import type { Category, Gender, Availability } from '@/config/taxonomy'
import type {
  OfferSummary,
  PricePoint,
  Product,
  ProductAttributes,
  ProductVariant,
} from '@/types/catalog'
import type { ProductSummary } from '@/types/discovery'

/**
 * Product reads.
 *
 * The important shape here is `loadProductSummaries`: given a set of product
 * ids it returns fully-assembled cards — canonical product, best offer, offer
 * count and a computed deal assessment — in a fixed number of queries
 * regardless of how many products were asked for. Every discovery surface
 * (home feed, search, saved) funnels through it, so there is exactly one
 * definition of "the offer we would send this user to" and one place where
 * deals are computed.
 */

/**
 * Ranking for choosing a product's headline offer:
 * buyable first, then cheapest, then a stable tiebreak on merchant name.
 */
const BEST_OFFER_ORDER = `
  (mp.availability in ('in_stock', 'low_stock')) desc,
  mp.current_price asc,
  m.name asc,
  mp.id asc
`

interface ProductRow {
  id: string
  canonical_title: string
  description: string | null
  brand: string
  category: string
  subcategory: string | null
  gender: string | null
  attributes: unknown
  match_key: string
  created_at: unknown
  updated_at: unknown
}

function toProduct(row: ProductRow): Product {
  return {
    id: str(row.id),
    canonicalTitle: str(row.canonical_title),
    description: strOrNull(row.description),
    brand: str(row.brand),
    category: str(row.category) as Category,
    subcategory: strOrNull(row.subcategory),
    gender: (strOrNull(row.gender) as Gender | null) ?? null,
    attributes: json<ProductAttributes>(row.attributes, {}),
    matchKey: str(row.match_key),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  }
}

interface OfferRow {
  id: string
  merchant_id: string
  product_id: string
  external_product_id: string
  title: string
  product_url: string
  affiliate_url: string | null
  image_url: string | null
  availability: string
  current_price: unknown
  original_price: unknown
  currency: string
  last_synced_at: unknown
  merchant_name: string
  merchant_slug: string
}

function toOffer(row: OfferRow): OfferSummary {
  return {
    id: str(row.id),
    merchantId: str(row.merchant_id),
    productId: str(row.product_id),
    externalProductId: str(row.external_product_id),
    title: str(row.title),
    productUrl: str(row.product_url),
    affiliateUrl: strOrNull(row.affiliate_url),
    imageUrl: strOrNull(row.image_url),
    availability: str(row.availability) as Availability,
    currentPrice: num(row.current_price),
    originalPrice: numOrNull(row.original_price),
    currency: str(row.currency, 'USD'),
    lastSyncedAt: isoDate(row.last_synced_at),
    merchantName: str(row.merchant_name),
    merchantSlug: str(row.merchant_slug),
  }
}

/**
 * Assemble product cards for the given ids.
 *
 * Three queries total, not three per product:
 *   1. products
 *   2. best offer + offer count per product (window function)
 *   3. price history for exactly those winning listings
 *
 * Returns results in the order the ids were supplied, which lets callers keep
 * whatever ranking they computed.
 */
export async function loadProductSummaries(
  db: Db,
  productIds: readonly string[],
  options: { now?: Date } = {},
): Promise<ProductSummary[]> {
  if (productIds.length === 0) return []

  const ids = [...productIds]

  const productRows = await db.query<ProductRow>(
    `select id, canonical_title, description, brand, category, subcategory, gender,
            attributes, match_key, created_at, updated_at
       from products
      where id = any($1::uuid[])`,
    [ids],
  )

  const offerRows = await db.query<OfferRow & { offer_count: unknown }>(
    `select * from (
       select mp.id, mp.merchant_id, mp.product_id, mp.external_product_id, mp.title,
              mp.product_url, mp.affiliate_url, mp.image_url, mp.availability,
              mp.current_price, mp.original_price, mp.currency, mp.last_synced_at,
              m.name as merchant_name, m.slug as merchant_slug,
              row_number() over (partition by mp.product_id order by ${BEST_OFFER_ORDER}) as rn,
              count(*)  over (partition by mp.product_id) as offer_count
         from merchant_products mp
         join merchants m on m.id = mp.merchant_id
        where mp.product_id = any($1::uuid[])
          and m.status = 'active'
     ) ranked
     where rn = 1`,
    [ids],
  )

  const listingIds = offerRows.map((row) => row.id)
  const historyByListing = await loadPriceHistories(db, listingIds)

  const productsById = new Map(productRows.map((row) => [str(row.id), toProduct(row)]))
  const offersByProduct = new Map(offerRows.map((row) => [str(row.product_id), row]))

  const summaries: ProductSummary[] = []

  for (const id of ids) {
    const product = productsById.get(id)
    const offerRow = offersByProduct.get(id)
    // A product with no active offer cannot be bought, so it is not shown.
    if (!product || !offerRow) continue

    const offer = toOffer(offerRow)

    summaries.push({
      product,
      offer,
      offerCount: num(offerRow.offer_count, 1),
      imageUrl: offer.imageUrl,
      deal: assessDeal({
        currentPrice: offer.currentPrice,
        originalPrice: offer.originalPrice,
        currency: offer.currency,
        history: historyByListing.get(offer.id) ?? [],
        now: options.now,
      }),
    })
  }

  return summaries
}

/** Price history for many listings in one query. */
export async function loadPriceHistories(
  db: Db,
  listingIds: readonly string[],
): Promise<Map<string, PricePoint[]>> {
  const result = new Map<string, PricePoint[]>()
  if (listingIds.length === 0) return result

  const rows = await db.query<{
    merchant_product_id: string
    price: unknown
    original_price: unknown
    recorded_at: unknown
    source: string
  }>(
    `select merchant_product_id, price, original_price, recorded_at, source
       from price_history
      where merchant_product_id = any($1::uuid[])
      order by recorded_at asc`,
    [[...listingIds]],
  )

  for (const row of rows) {
    const key = str(row.merchant_product_id)
    const points = result.get(key) ?? []
    points.push({
      price: num(row.price),
      originalPrice: numOrNull(row.original_price),
      recordedAt: isoDate(row.recorded_at),
      source: str(row.source),
    })
    result.set(key, points)
  }

  return result
}

export interface ProductDetail extends ProductSummary {
  /** Every active offer, cheapest buyable first. */
  offers: OfferSummary[]
  variants: ProductVariant[]
  /** Price history for the headline offer, for the chart. */
  priceHistory: PricePoint[]
  images: string[]
}

export async function loadProductDetail(
  db: Db,
  productId: string,
  options: { now?: Date } = {},
): Promise<ProductDetail | null> {
  const [summary] = await loadProductSummaries(db, [productId], options)
  if (!summary) return null

  const offerRows = await db.query<OfferRow>(
    `select mp.id, mp.merchant_id, mp.product_id, mp.external_product_id, mp.title,
            mp.product_url, mp.affiliate_url, mp.image_url, mp.availability,
            mp.current_price, mp.original_price, mp.currency, mp.last_synced_at,
            m.name as merchant_name, m.slug as merchant_slug
       from merchant_products mp
       join merchants m on m.id = mp.merchant_id
      where mp.product_id = $1 and m.status = 'active'
      order by ${BEST_OFFER_ORDER}`,
    [productId],
  )

  const variantRows = await db.query<{
    id: string
    product_id: string
    sku: string | null
    size: string | null
    color: string | null
    variant_attributes: unknown
  }>(
    `select id, product_id, sku, size, color, variant_attributes
       from product_variants where product_id = $1 order by size nulls last, color nulls last`,
    [productId],
  )

  const imageRows = await db.query<{ url: string }>(
    `select distinct url from product_images where product_id = $1 order by url`,
    [productId],
  )

  const histories = await loadPriceHistories(db, [summary.offer.id])

  return {
    ...summary,
    offers: offerRows.map(toOffer),
    variants: variantRows.map((row) => ({
      id: str(row.id),
      productId: str(row.product_id),
      sku: strOrNull(row.sku),
      size: strOrNull(row.size),
      color: strOrNull(row.color),
      variantAttributes: json<Record<string, unknown>>(row.variant_attributes, {}),
    })),
    priceHistory: histories.get(summary.offer.id) ?? [],
    images: imageRows.map((row) => str(row.url)),
  }
}

/**
 * Candidate products for recommendation, restricted to things a user could
 * actually buy and has not already rejected.
 */
export async function loadCandidateProductIds(
  db: Db,
  options: {
    userId?: string | null
    categories?: readonly string[]
    excludeProductIds?: readonly string[]
    limit?: number
  } = {},
): Promise<string[]> {
  const params: unknown[] = []
  const where: string[] = [`mp.availability in ('in_stock', 'low_stock')`, `m.status = 'active'`]

  if (options.categories && options.categories.length > 0) {
    params.push([...options.categories])
    where.push(`p.category = any($${params.length}::text[])`)
  }

  if (options.userId) {
    params.push(options.userId)
    where.push(
      `not exists (select 1 from product_rejections pr
                    where pr.product_id = p.id and pr.user_id = $${params.length})`,
    )
  }

  if (options.excludeProductIds && options.excludeProductIds.length > 0) {
    params.push([...options.excludeProductIds])
    where.push(`p.id <> all($${params.length}::uuid[])`)
  }

  params.push(options.limit ?? 300)

  const rows = await db.query<{ id: string }>(
    `select p.id
       from products p
       join merchant_products mp on mp.product_id = p.id
       join merchants m on m.id = mp.merchant_id
      where ${where.join(' and ')}
      group by p.id, p.created_at
      order by p.created_at desc
      limit $${params.length}`,
    params,
  )

  return rows.map((row) => str(row.id))
}

/** Distinct brands present in the catalogue, for filters and preferences. */
export async function listBrands(db: Db, limit = 100): Promise<string[]> {
  const rows = await db.query<{ brand: string }>(
    `select brand, count(*)::int as n from products
      group by brand order by n desc, brand asc limit $1`,
    [limit],
  )
  return rows.map((row) => str(row.brand))
}
