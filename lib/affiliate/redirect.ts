import 'server-only'
import { randomUUID } from 'node:crypto'
import type { Db } from '@/lib/db/types'
import { num, str, stringArray, strOrNull } from '@/lib/db/rows'
import { logger } from '@/lib/logging/logger'
import { validateRedirectTarget } from '@/lib/utils/url'

/**
 * Merchant click-out.
 *
 * Two jobs, in this order:
 *   1. Refuse to become an open redirect.
 *   2. Record the click, because it is the closest thing Phase 1 has to a
 *      conversion event and the whole business model rests on it.
 *
 * The destination is never taken from the request. The caller supplies a
 * *listing id*; this module looks up that listing's URL and validates it
 * against the owning merchant's registered host allowlist. A URL that fails
 * validation is not followed — a broken link is recoverable, an open redirect
 * on Bloom's domain is a phishing vector wearing our name.
 */

export type ClickOutcome =
  | { ok: true; clickId: string; destination: string; merchantSlug: string }
  | { ok: false; reason: 'not_found' | 'unavailable' | 'invalid_destination' }

interface ListingRow {
  id: string
  product_id: string
  merchant_id: string
  product_url: string
  affiliate_url: string | null
  availability: string
  current_price: unknown
  currency: string
  external_product_id: string
  merchant_slug: string
  merchant_status: string
  allowed_hosts: unknown
}

export async function resolveMerchantClick(
  db: Db,
  options: {
    merchantProductId: string
    userId: string | null
    sessionId?: string | null
  },
): Promise<ClickOutcome> {
  const rows = await db.query<ListingRow>(
    `select mp.id, mp.product_id, mp.merchant_id, mp.product_url, mp.affiliate_url,
            mp.availability, mp.current_price, mp.currency, mp.external_product_id,
            m.slug as merchant_slug, m.status as merchant_status, m.allowed_hosts
       from merchant_products mp
       join merchants m on m.id = mp.merchant_id
      where mp.id = $1`,
    [options.merchantProductId],
  )

  const listing = rows[0]
  if (!listing) return { ok: false, reason: 'not_found' }
  if (str(listing.merchant_status) !== 'active') return { ok: false, reason: 'unavailable' }

  const allowedHosts = stringArray(listing.allowed_hosts)

  // Prefer a stored affiliate URL when one exists, but validate it exactly as
  // strictly as the plain product URL — a compromised feed could supply either.
  const candidate = strOrNull(listing.affiliate_url) ?? str(listing.product_url)
  const destination = validateRedirectTarget(candidate, allowedHosts)

  if (!destination) {
    logger.error('refusing merchant redirect: destination failed host allowlist', {
      merchantProductId: options.merchantProductId,
      merchantSlug: str(listing.merchant_slug),
      allowedHosts,
    })
    return { ok: false, reason: 'invalid_destination' }
  }

  const clickId = randomUUID()

  await db.query(
    `insert into affiliate_clicks
       (id, user_id, merchant_id, product_id, merchant_product_id, destination_url, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      clickId,
      options.userId,
      listing.merchant_id,
      listing.product_id,
      listing.id,
      destination.toString(),
      JSON.stringify({
        sessionId: options.sessionId ?? null,
        priceAtClick: num(listing.current_price),
        currency: str(listing.currency, 'USD'),
        availability: str(listing.availability),
        externalProductId: str(listing.external_product_id),
      }),
    ],
  )

  return {
    ok: true,
    clickId,
    destination: destination.toString(),
    merchantSlug: str(listing.merchant_slug),
  }
}
