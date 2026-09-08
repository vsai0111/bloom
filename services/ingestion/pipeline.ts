import type { Db } from '@/lib/db/types'
import type { MerchantProvider } from '@/lib/merchants/provider'
import { logger } from '@/lib/logging/logger'
import { normalizeProduct, type NormalizedProduct } from '@/services/normalization/normalize'

/**
 * The ingestion pipeline.
 *
 *   provider -> validation -> normalization -> canonical product
 *            -> variants -> merchant listing -> price observation
 *
 * Provider-agnostic by construction: it accepts any `MerchantProvider`, so
 * adding a real merchant feed means writing a provider, not touching this file.
 *
 * Failures are per-product, not per-batch. One malformed listing in a feed of
 * ten thousand must not abort the run, but it must also never be silently
 * dropped — every rejection is counted and returned.
 */

export interface IngestionSummary {
  merchantSlug: string
  merchantId: string
  fetched: number
  ingested: number
  rejected: number
  warnings: number
  /** Capped sample of rejections, for logging and the ingestion report. */
  rejectionSamples: Array<{ externalId: string; errors: string[] }>
}

export interface IngestOptions {
  /** Stop after this many products. Useful for smoke tests. */
  limit?: number
  /** Backfill historical prices for each listing. Seed provider only. */
  backfillHistory?: (externalId: string) => Array<{ price: number; recordedAt: Date }>
  /** Timestamp recorded for the current price observation. */
  now?: Date
}

const MAX_REJECTION_SAMPLES = 20

export async function ingestFromProvider(
  db: Db,
  provider: MerchantProvider,
  options: IngestOptions = {},
): Promise<IngestionSummary> {
  const descriptor = provider.descriptor()
  const log = logger.child({ provider: provider.id, merchant: descriptor.slug })

  const merchantId = await upsertMerchant(db, descriptor)

  const summary: IngestionSummary = {
    merchantSlug: descriptor.slug,
    merchantId,
    fetched: 0,
    ingested: 0,
    rejected: 0,
    warnings: 0,
    rejectionSamples: [],
  }

  let cursor: string | null = null

  do {
    const page = await provider.getProducts({ cursor, limit: 50 })
    cursor = page.cursor

    for (const raw of page.products) {
      if (options.limit !== undefined && summary.fetched >= options.limit) {
        cursor = null
        break
      }
      summary.fetched += 1

      const outcome = normalizeProduct(raw)

      if (!outcome.ok) {
        summary.rejected += 1
        if (summary.rejectionSamples.length < MAX_REJECTION_SAMPLES) {
          summary.rejectionSamples.push({ externalId: raw.externalId, errors: outcome.errors })
        }
        log.warn('product rejected during normalization', {
          externalId: raw.externalId,
          errors: outcome.errors,
        })
        continue
      }

      summary.warnings += outcome.warnings.length

      try {
        await persistProduct(db, merchantId, outcome.value, options)
        summary.ingested += 1
      } catch (error) {
        summary.rejected += 1
        if (summary.rejectionSamples.length < MAX_REJECTION_SAMPLES) {
          summary.rejectionSamples.push({
            externalId: raw.externalId,
            errors: [error instanceof Error ? error.message : 'unknown persistence error'],
          })
        }
        log.error('failed to persist product', { externalId: raw.externalId, error })
      }
    }
  } while (cursor)

  log.info('ingestion complete', { ...summary, rejectionSamples: summary.rejectionSamples.length })
  return summary
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function upsertMerchant(
  db: Db,
  descriptor: ReturnType<MerchantProvider['descriptor']>,
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `insert into merchants (name, slug, website_url, logo_url, allowed_hosts, status)
     values ($1, $2, $3, $4, $5, 'active')
     on conflict (slug) do update
       set name = excluded.name,
           website_url = excluded.website_url,
           logo_url = excluded.logo_url,
           allowed_hosts = excluded.allowed_hosts
     returning id`,
    [
      descriptor.name,
      descriptor.slug,
      descriptor.websiteUrl,
      descriptor.logoUrl ?? null,
      descriptor.allowedHosts,
    ],
  )
  return rows[0].id
}

async function persistProduct(
  db: Db,
  merchantId: string,
  product: NormalizedProduct,
  options: IngestOptions,
): Promise<void> {
  await db.transaction(async (tx) => {
    // --- Canonical product ---------------------------------------------------
    // On conflict the existing canonical record wins for fields it already has:
    // a second merchant listing the same product may fill in gaps but must not
    // overwrite what the first one established.
    const productRows = await tx.query<{ id: string }>(
      `insert into products
         (canonical_title, description, brand, category, subcategory, gender, attributes, keywords, match_key)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       on conflict (match_key) do update
         set description = coalesce(products.description, excluded.description),
             subcategory = coalesce(products.subcategory, excluded.subcategory),
             gender      = coalesce(products.gender, excluded.gender),
             attributes  = products.attributes || excluded.attributes,
             keywords    = case
                             when length(excluded.keywords) > length(products.keywords)
                             then excluded.keywords else products.keywords
                           end,
             updated_at  = now()
       returning id`,
      [
        product.canonicalTitle,
        product.description,
        product.brand,
        product.category,
        product.subcategory,
        product.gender,
        JSON.stringify(product.attributes),
        product.keywords,
        product.matchKey,
      ],
    )
    const productId = productRows[0].id

    // --- Variants ------------------------------------------------------------
    for (const variant of product.variants) {
      await tx.query(
        `insert into product_variants (product_id, sku, size, color, variant_attributes)
         values ($1, $2, $3, $4, $5::jsonb)
         on conflict (product_id, coalesce(size, ''), coalesce(color, ''))
         do update set sku = coalesce(excluded.sku, product_variants.sku),
                       variant_attributes = excluded.variant_attributes,
                       updated_at = now()`,
        [
          productId,
          variant.sku,
          variant.size,
          variant.color,
          JSON.stringify(variant.variantAttributes),
        ],
      )
    }

    // --- Merchant listing ----------------------------------------------------
    const listing = product.listing
    const listingRows = await tx.query<{ id: string }>(
      `insert into merchant_products
         (merchant_id, product_id, external_product_id, title, product_url, affiliate_url,
          image_url, availability, current_price, original_price, currency, metadata, last_synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
       on conflict (merchant_id, external_product_id) do update
         set product_id     = excluded.product_id,
             title          = excluded.title,
             product_url    = excluded.product_url,
             affiliate_url  = excluded.affiliate_url,
             image_url      = excluded.image_url,
             availability   = excluded.availability,
             current_price  = excluded.current_price,
             original_price = excluded.original_price,
             currency       = excluded.currency,
             last_synced_at = now(),
             updated_at     = now()
       returning id`,
      [
        merchantId,
        productId,
        listing.externalProductId,
        listing.title,
        listing.productUrl,
        // Affiliate URLs are minted per click (they embed a click id), so no
        // static URL is stored at ingestion time. See lib/affiliate/redirect.ts.
        null,
        listing.imageUrl,
        listing.availability,
        listing.currentPrice,
        listing.originalPrice,
        listing.currency,
        JSON.stringify({ matchStrategy: product.matchStrategy }),
      ],
    )
    const listingId = listingRows[0].id

    // --- Images --------------------------------------------------------------
    for (const [index, url] of product.images.entries()) {
      await tx.query(
        `insert into product_images (product_id, merchant_product_id, url, alt_text, position)
         select $1, $2, $3, $4, $5
         where not exists (
           select 1 from product_images
           where merchant_product_id = $2 and url = $3
         )`,
        [productId, listingId, url, `${product.brand} ${product.canonicalTitle}`, index],
      )
    }

    // --- Price history -------------------------------------------------------
    const backfill = options.backfillHistory?.(listing.externalProductId) ?? []
    if (backfill.length > 0) {
      const existing = await tx.query<{ n: number }>(
        `select count(*)::int as n from price_history where merchant_product_id = $1`,
        [listingId],
      )
      // Only backfill once. Re-running ingestion must not multiply history.
      if ((existing[0]?.n ?? 0) === 0) {
        // One multi-row INSERT rather than a statement per observation: a
        // backfill is ~30 rows per listing, and round-tripping each one
        // separately is both slow and needlessly heavy on the connection.
        const values: unknown[] = [listingId, listing.currency]
        const tuples = backfill.map((point) => {
          values.push(point.price, point.recordedAt.toISOString())
          return `($1, $${values.length - 1}, $2, $${values.length}, 'seed')`
        })

        await tx.query(
          `insert into price_history (merchant_product_id, price, currency, recorded_at, source)
           values ${tuples.join(', ')}`,
          values,
        )
      }
    } else {
      // Normal operation: record the observation we just made, but only when the
      // price actually changed, so history stays a change log rather than a poll log.
      await tx.query(
        `insert into price_history (merchant_product_id, price, original_price, currency, recorded_at, source)
         select $1, $2, $3, $4, $5, 'sync'
         where not exists (
           select 1 from price_history
           where merchant_product_id = $1
             and price = $2
             and recorded_at = (
               select max(recorded_at) from price_history where merchant_product_id = $1
             )
         )`,
        [
          listingId,
          listing.currentPrice,
          listing.originalPrice,
          listing.currency,
          (options.now ?? new Date()).toISOString(),
        ],
      )
    }
  })
}
