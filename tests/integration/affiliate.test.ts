import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveMerchantClick } from '@/lib/affiliate/redirect'
import { createTestDb, createTestUser, type TestDb } from '../helpers/db'

/**
 * Merchant click-out.
 *
 * The commercial event, and the one endpoint that turns internal data into an
 * outbound redirect — so the tests here are as much about refusing bad
 * destinations as about recording good ones.
 */
describe('merchant click-out', () => {
  let context: TestDb
  let userId: string
  let listingId: string
  let merchantId: string

  beforeAll(async () => {
    context = await createTestDb()
    userId = (await createTestUser(context.db)).id

    const rows = await context.db.query<{ id: string; merchant_id: string }>(
      `select id, merchant_id from merchant_products limit 1`,
    )
    listingId = rows[0].id
    merchantId = rows[0].merchant_id
  }, 120_000)

  afterAll(async () => {
    await context?.close()
  })

  it('resolves a valid listing to its merchant URL and records the click', async () => {
    const outcome = await resolveMerchantClick(context.db, { merchantProductId: listingId, userId })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.destination).toMatch(/^https?:\/\//)

    const clicks = await context.db.query<{
      user_id: string
      destination_url: string
      metadata: unknown
    }>(`select user_id, destination_url, metadata from affiliate_clicks where id = $1`, [
      outcome.clickId,
    ])

    expect(clicks).toHaveLength(1)
    expect(clicks[0].user_id).toBe(userId)
    expect(clicks[0].destination_url).toBe(outcome.destination)

    // Price at click time is captured so conversion value can be reconciled later.
    const metadata = clicks[0].metadata as Record<string, unknown>
    expect(typeof metadata.priceAtClick).toBe('number')
  })

  it('records an anonymous click without a user', async () => {
    const outcome = await resolveMerchantClick(context.db, {
      merchantProductId: listingId,
      userId: null,
    })
    expect(outcome.ok).toBe(true)
  })

  it('refuses an unknown listing', async () => {
    const outcome = await resolveMerchantClick(context.db, {
      merchantProductId: '00000000-0000-0000-0000-000000000000',
      userId,
    })
    expect(outcome).toEqual({ ok: false, reason: 'not_found' })
  })

  it('refuses a merchant that is not active', async () => {
    await context.db.query(`update merchants set status = 'disabled' where id = $1`, [merchantId])
    try {
      const outcome = await resolveMerchantClick(context.db, {
        merchantProductId: listingId,
        userId,
      })
      expect(outcome).toEqual({ ok: false, reason: 'unavailable' })
    } finally {
      await context.db.query(`update merchants set status = 'active' where id = $1`, [merchantId])
    }
  })

  it('refuses a destination outside the merchant host allowlist', async () => {
    // Simulates a poisoned feed: the listing URL points somewhere the merchant
    // is not registered for. Bloom must not follow it.
    const original = await context.db.query<{ product_url: string }>(
      `select product_url from merchant_products where id = $1`,
      [listingId],
    )

    await context.db.query(
      `update merchant_products set product_url = 'https://evil.test/phish' where id = $1`,
      [listingId],
    )

    try {
      const outcome = await resolveMerchantClick(context.db, {
        merchantProductId: listingId,
        userId,
      })
      expect(outcome).toEqual({ ok: false, reason: 'invalid_destination' })

      // And nothing must be recorded as a click to a destination we refused.
      const clicks = await context.db.query<{ n: number }>(
        `select count(*)::int as n from affiliate_clicks where destination_url like '%evil.test%'`,
      )
      expect(clicks[0].n).toBe(0)
    } finally {
      await context.db.query(`update merchant_products set product_url = $2 where id = $1`, [
        listingId,
        original[0].product_url,
      ])
    }
  })

  it('refuses a merchant with an empty host allowlist', async () => {
    const original = await context.db.query<{ allowed_hosts: string[] }>(
      `select allowed_hosts from merchants where id = $1`,
      [merchantId],
    )

    await context.db.query(`update merchants set allowed_hosts = '{}' where id = $1`, [merchantId])

    try {
      const outcome = await resolveMerchantClick(context.db, {
        merchantProductId: listingId,
        userId,
      })
      // Fail closed: no allowlist means no redirect, not "allow everything".
      expect(outcome).toEqual({ ok: false, reason: 'invalid_destination' })
    } finally {
      await context.db.query(`update merchants set allowed_hosts = $2 where id = $1`, [
        merchantId,
        original[0].allowed_hosts,
      ])
    }
  })

  it('leaves conversion columns untouched in Phase 1', async () => {
    const rows = await context.db.query<{ n: number }>(
      `select count(*)::int as n from affiliate_clicks where converted_at is not null`,
    )
    expect(rows[0].n).toBe(0)
  })
})
