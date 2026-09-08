import type { Db } from '@/lib/db/types'
import { logger } from '@/lib/logging/logger'
import { SEED_MERCHANTS } from '@/supabase/seed/catalog'
import { ingestFromProvider, type IngestionSummary } from './pipeline'
import { SeedMerchantProvider } from './providers/seed-provider'

/**
 * Populate the catalogue from the seed providers.
 *
 * Runs the real ingestion pipeline — the same normalization, matching and
 * persistence a live merchant feed would go through — so seeding is a genuine
 * exercise of the system rather than a set of hand-written INSERTs that could
 * drift from what production does.
 *
 * Idempotent: everything upserts on a natural key, and price history backfill
 * is skipped for listings that already have history.
 */

export interface SeedSummary {
  merchants: number
  productsIngested: number
  productsRejected: number
  canonicalProducts: number
  listings: number
  pricePoints: number
}

export interface SeedOptions {
  /** Fixed clock, so seeded histories are reproducible in tests. */
  now?: Date
  /** Cap products per merchant. */
  limit?: number
}

export async function seedDatabase(db: Db, options: SeedOptions = {}): Promise<SeedSummary> {
  const now = options.now ?? new Date()
  const summaries: IngestionSummary[] = []

  for (const merchant of SEED_MERCHANTS) {
    const provider = new SeedMerchantProvider(merchant, { now })
    summaries.push(
      await ingestFromProvider(db, provider, {
        now,
        limit: options.limit,
        backfillHistory: (externalId) => provider.historyFor(externalId),
      }),
    )
  }

  const counts = await db.query<{ products: number; listings: number; prices: number }>(
    `select
       (select count(*)::int from products)          as products,
       (select count(*)::int from merchant_products) as listings,
       (select count(*)::int from price_history)     as prices`,
  )

  const summary: SeedSummary = {
    merchants: SEED_MERCHANTS.length,
    productsIngested: summaries.reduce((total, s) => total + s.ingested, 0),
    productsRejected: summaries.reduce((total, s) => total + s.rejected, 0),
    canonicalProducts: counts[0]?.products ?? 0,
    listings: counts[0]?.listings ?? 0,
    pricePoints: counts[0]?.prices ?? 0,
  }

  logger.info('seed complete', { ...summary })
  return summary
}
