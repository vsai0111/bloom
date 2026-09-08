import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  listActivePreferences,
  listPreferences,
  removePreference,
  upsertPreference,
} from '@/lib/preferences/repository'
import {
  listSavedProducts,
  loadProductStates,
  rejectProduct,
  toggleLike,
  toggleSave,
} from '@/lib/engagement/repository'
import { loadCandidateProductIds, loadProductSummaries } from '@/lib/products/repository'
import { buildHomeFeed, rankSummaries } from '@/lib/recommendations/service'
import { recordEvent } from '@/lib/analytics/events'
import { createTestDb, createTestUser, TEST_NOW, type TestDb } from '../helpers/db'

/**
 * The personalisation loop, end to end against a real database.
 *
 *   preference -> ranking -> action -> learned preference -> better ranking
 *
 * This is the product hypothesis expressed as a test. If it passes, the loop the
 * whole product depends on actually closes.
 */
describe('personalisation', () => {
  let context: TestDb
  let userId: string

  beforeAll(async () => {
    context = await createTestDb()
    userId = (await createTestUser(context.db)).id
  }, 120_000)

  afterAll(async () => {
    await context?.close()
  })

  it('stores explicit preferences and reads them back', async () => {
    const created = await upsertPreference(context.db, userId, {
      attribute: 'color',
      value: 'Olive',
      source: 'explicit',
    })

    expect(created).not.toBeNull()
    // Values are normalised to lower case so matching is case-insensitive.
    expect(created!.value).toBe('olive')
    expect(created!.source).toBe('explicit')

    const all = await listPreferences(context.db, userId)
    expect(all.some((p) => p.value === 'olive')).toBe(true)
  })

  it('accepts a category preference', async () => {
    // Regression: `category` was missing from the allowed attribute list, so
    // onboarding's most important question silently saved nothing.
    const created = await upsertPreference(context.db, userId, {
      attribute: 'category',
      value: 'clothing',
      source: 'explicit',
    })

    expect(created).not.toBeNull()
    expect(created!.attribute).toBe('category')
  })

  it('refuses an attribute outside the controlled vocabulary', async () => {
    const created = await upsertPreference(context.db, userId, {
      attribute: 'favourite_animal',
      value: 'otter',
    })
    expect(created).toBeNull()
  })

  it('upserts rather than duplicating the same preference', async () => {
    await upsertPreference(context.db, userId, { attribute: 'color', value: 'olive' })
    await upsertPreference(context.db, userId, { attribute: 'color', value: 'olive' })

    const all = await listPreferences(context.db, userId)
    expect(all.filter((p) => p.attribute === 'color' && p.value === 'olive')).toHaveLength(1)
  })

  it('removes a preference only for its owner', async () => {
    const other = (await createTestUser(context.db, 'Other')).id
    const theirs = await upsertPreference(context.db, other, {
      attribute: 'color',
      value: 'navy',
    })

    // Wrong owner: must not delete.
    expect(await removePreference(context.db, userId, theirs!.id)).toBe(false)
    expect(await removePreference(context.db, other, theirs!.id)).toBe(true)
  })

  it('ranks a product matching the user preferences above one that does not', async () => {
    const ids = await loadCandidateProductIds(context.db, { limit: 60 })
    const summaries = await loadProductSummaries(context.db, ids, { now: TEST_NOW })

    const olive = summaries.find((s) => s.product.attributes.color === 'olive')
    const notOlive = summaries.find(
      (s) => s.product.attributes.color && s.product.attributes.color !== 'olive',
    )
    expect(olive).toBeDefined()
    expect(notOlive).toBeDefined()

    const preferences = await listActivePreferences(context.db, userId)
    const ranked = rankSummaries([notOlive!, olive!], preferences)

    const oliveRank = ranked.findIndex((r) => r.product.id === olive!.product.id)
    const otherRank = ranked.findIndex((r) => r.product.id === notOlive!.product.id)
    expect(oliveRank).toBeLessThan(otherRank)
  })

  it('learns from a save, and surfaces it as an inspectable preference', async () => {
    const fresh = (await createTestUser(context.db, 'Learner')).id
    const ids = await loadCandidateProductIds(context.db, { limit: 5 })
    const [summary] = await loadProductSummaries(context.db, [ids[0]], { now: TEST_NOW })

    const before = await listPreferences(context.db, fresh)
    expect(before).toHaveLength(0)

    await toggleSave(context.db, fresh, summary.product.id)

    const after = await listPreferences(context.db, fresh)
    expect(after.length).toBeGreaterThan(0)

    // Everything learned must be attributable and visible to the user.
    expect(after.every((p) => p.source === 'behavioral')).toBe(true)
    expect(after.some((p) => p.value === summary.product.brand.toLowerCase())).toBe(true)
  })

  it('does not create a category-scoped duplicate of an explicit preference', async () => {
    // Onboarding writes global preferences; learning previously wrote
    // category-scoped ones, so one taste produced two near-identical rows.
    const fresh = (await createTestUser(context.db, 'NoDupes')).id

    const ids = await loadCandidateProductIds(context.db, { limit: 5 })
    const [summary] = await loadProductSummaries(context.db, [ids[0]], { now: TEST_NOW })

    await upsertPreference(context.db, fresh, {
      attribute: 'color',
      value: summary.product.attributes.color ?? 'olive',
      source: 'explicit',
    })
    await toggleSave(context.db, fresh, summary.product.id)
    await toggleLike(context.db, fresh, summary.product.id)

    const all = await listPreferences(context.db, fresh)
    const seen = new Set<string>()
    for (const preference of all) {
      const key = `${preference.attribute}:${preference.value}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }

    // And the explicit statement must survive the behavioural signals intact.
    const color = all.find((p) => p.attribute === 'color')
    expect(color?.source).toBe('explicit')
  })

  it('holds a single weak signal back from influencing ranking', async () => {
    const fresh = (await createTestUser(context.db, 'Cautious')).id
    const ids = await loadCandidateProductIds(context.db, { limit: 5 })
    const [summary] = await loadProductSummaries(context.db, [ids[0]], { now: TEST_NOW })

    await toggleSave(context.db, fresh, summary.product.id)

    const all = await listPreferences(context.db, fresh)
    const active = await listActivePreferences(context.db, fresh)

    // Recorded, but not yet acted upon: one signal is not a stated taste.
    expect(all.length).toBeGreaterThan(0)
    expect(active.length).toBeLessThan(all.length)
  })

  it('toggles save and like off again', async () => {
    const ids = await loadCandidateProductIds(context.db, { limit: 3 })
    const productId = ids[1]

    expect((await toggleSave(context.db, userId, productId)).saved).toBe(true)
    expect((await toggleSave(context.db, userId, productId)).saved).toBe(false)

    expect((await toggleLike(context.db, userId, productId)).liked).toBe(true)
    expect((await toggleLike(context.db, userId, productId)).liked).toBe(false)
  })

  it('records the price at save time so price movement is personal', async () => {
    const fresh = (await createTestUser(context.db, 'Saver')).id
    const ids = await loadCandidateProductIds(context.db, { limit: 3 })

    await toggleSave(context.db, fresh, ids[0])
    const saved = await listSavedProducts(context.db, fresh, { now: TEST_NOW })

    expect(saved).toHaveLength(1)
    expect(saved[0].priceAtSave).not.toBeNull()
    // Nothing has changed yet, so the delta must be exactly zero, not null.
    expect(saved[0].priceChange).toBe(0)
  })

  it('removes a rejected product from the feed and from saved', async () => {
    const fresh = (await createTestUser(context.db, 'Rejector')).id
    const ids = await loadCandidateProductIds(context.db, { limit: 10 })
    const target = ids[0]

    await toggleSave(context.db, fresh, target)
    await rejectProduct(context.db, fresh, target, 'not_my_style')

    const states = await loadProductStates(context.db, fresh, [target])
    expect(states.get(target)).toEqual({ saved: false, liked: false, rejected: true })

    const candidates = await loadCandidateProductIds(context.db, { userId: fresh, limit: 100 })
    expect(candidates).not.toContain(target)
  })

  it('builds a home feed with populated, non-duplicated sections', async () => {
    const shopper = (await createTestUser(context.db, 'Shopper')).id

    await upsertPreference(context.db, shopper, { attribute: 'category', value: 'clothing' })
    await upsertPreference(context.db, shopper, { attribute: 'color', value: 'olive' })

    const sections = await buildHomeFeed(context.db, { userId: shopper, now: TEST_NOW })

    expect(sections.length).toBeGreaterThan(0)
    expect(sections[0].id).toBe('for-you')

    for (const section of sections) {
      // No empty sections, ever.
      expect(section.items.length).toBeGreaterThan(0)

      // No product repeated within a section.
      const ids = section.items.map((item) => item.product.id)
      expect(new Set(ids).size).toBe(ids.length)

      // Diversity: no brand may dominate a row.
      const brands = section.items.map((item) => item.product.brand)
      for (const brand of new Set(brands)) {
        expect(brands.filter((b) => b === brand).length).toBeLessThanOrEqual(4)
      }
    }
  })

  it('excludes rejected products from every feed section', async () => {
    const shopper = (await createTestUser(context.db, 'Picky')).id
    await upsertPreference(context.db, shopper, { attribute: 'category', value: 'clothing' })

    const first = await buildHomeFeed(context.db, { userId: shopper, now: TEST_NOW })
    const victim = first[0].items[0].product.id

    await rejectProduct(context.db, shopper, victim)

    const second = await buildHomeFeed(context.db, { userId: shopper, now: TEST_NOW })
    const allIds = second.flatMap((section) => section.items.map((item) => item.product.id))
    expect(allIds).not.toContain(victim)
  })

  it('records events for the funnel', async () => {
    const tracked = (await createTestUser(context.db, 'Tracked')).id

    await recordEvent(context.db, { userId: tracked, eventType: 'home_view' })
    await recordEvent(context.db, { userId: tracked, eventType: 'product_viewed' })

    const rows = await context.db.query<{ event_type: string }>(
      `select event_type from user_events where user_id = $1 order by created_at`,
      [tracked],
    )
    expect(rows.map((r) => r.event_type)).toEqual(['home_view', 'product_viewed'])
  })

  it('drops an anonymous event that requires a user rather than storing a null owner', async () => {
    const before = await context.db.query<{ n: number }>(
      `select count(*)::int as n from user_events`,
    )
    await recordEvent(context.db, { eventType: 'product_viewed' })
    const after = await context.db.query<{ n: number }>(
      `select count(*)::int as n from user_events`,
    )
    expect(after[0].n).toBe(before[0].n)
  })

  it('allows pre-signup funnel events without a user', async () => {
    await recordEvent(context.db, { eventType: 'landing_view', sessionId: 'sess-1' })
    const rows = await context.db.query<{ n: number }>(
      `select count(*)::int as n from user_events where event_type = 'landing_view'`,
    )
    expect(rows[0].n).toBeGreaterThan(0)
  })
})
