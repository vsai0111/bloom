import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { getSessionId } from '@/lib/analytics/session'
import { resolveMerchantClick } from '@/lib/affiliate/redirect'
import { reportError, logger } from '@/lib/logging/logger'

/**
 * Merchant click-out.
 *
 *   GET /go/<merchantProductId>  ->  302 to the validated merchant URL
 *
 * The destination is looked up from the listing id and validated against the
 * merchant's registered host allowlist before any redirect is issued. There is
 * deliberately no way to pass a URL to this endpoint — that is what would make
 * it an open redirect.
 *
 * The click is recorded before redirecting, because it is the closest thing
 * Phase 1 has to a conversion signal.
 */

const idSchema = z.string().uuid()

export async function GET(
  request: Request,
  { params }: { params: Promise<{ merchantProductId: string }> },
): Promise<Response> {
  const { merchantProductId } = await params

  if (!idSchema.safeParse(merchantProductId).success) {
    return NextResponse.redirect(new URL('/home?error=unknown-product', request.url), 302)
  }

  try {
    const [user, db, sessionId] = await Promise.all([getCurrentUser(), getDb(), getSessionId()])

    const outcome = await resolveMerchantClick(db, {
      merchantProductId,
      userId: user?.id ?? null,
      sessionId,
    })

    if (!outcome.ok) {
      logger.warn('merchant click refused', { merchantProductId, reason: outcome.reason })
      return NextResponse.redirect(
        new URL(`/home?error=${encodeURIComponent(outcome.reason)}`, request.url),
        302,
      )
    }

    await recordEvent(db, {
      userId: user?.id ?? null,
      sessionId,
      eventType: 'merchant_clicked',
      merchantProductId,
      metadata: { clickId: outcome.clickId, merchant: outcome.merchantSlug },
    })

    const response = NextResponse.redirect(outcome.destination, 302)
    // Do not leak the user's Bloom page path to the merchant.
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    const reference = reportError(error, { operation: 'merchantClick', merchantProductId })
    return NextResponse.redirect(new URL(`/home?error=redirect&ref=${reference}`, request.url), 302)
  }
}
