import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listPreferences, upsertPreference, upsertPreferences } from '@/lib/preferences/repository'
import type { Db } from '@/lib/db/types'
import { createTestDb, createTestUser, type TestDb } from '../helpers/db'

/**
 * Batched preference writes.
 *
 * Onboarding submits a whole step at once. Writing one row per round trip made
 * the cost of a step proportional to how many answers the user gave, which
 * against a database in another region is the difference between one ~200ms
 * wait and four. These tests pin both the semantics and the round-trip count —
 * the latter being the entire point of the change.
 */

let ctx: TestDb

beforeAll(async () => {
  ctx = await createTestDb({ seed: false })
})

afterAll(async () => {
  await ctx?.close()
})

/** Wraps a Db so the number of statements issued can be asserted. */
function counting(db: Db): { db: Db; queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    db: {
      query: (text: string, params?: readonly unknown[]) => {
        queries.push(text)
        return db.query(text, params)
      },
      exec: (text: string) => db.exec(text),
      transaction: (fn: (tx: Db) => Promise<unknown>) => db.transaction(fn),
    } as Db,
  }
}

describe('upsertPreferences', () => {
  it('writes a whole onboarding step in a single round trip', async () => {
    const { id } = await createTestUser(ctx.db, 'Batch User')
    const probe = counting(ctx.db)

    const written = await upsertPreferences(probe.db, id, [
      { attribute: 'category', value: 'clothing', weight: 0.9 },
      { attribute: 'category', value: 'footwear', weight: 0.9 },
      { attribute: 'category', value: 'accessories', weight: 0.9 },
      { attribute: 'category', value: 'home', weight: 0.9 },
    ])

    expect(written).toHaveLength(4)
    // The regression this guards: one statement per answer.
    expect(probe.queries).toHaveLength(1)
  })

  it('stores exactly what the single-value path would have stored', async () => {
    const { id } = await createTestUser(ctx.db, 'Parity User')

    await upsertPreferences(ctx.db, id, [
      { attribute: 'color', value: '  Olive  ', weight: 0.75 },
      { attribute: 'fit', value: 'RELAXED', weight: 0.7 },
    ])

    const stored = await listPreferences(ctx.db, id)
    const olive = stored.find((p) => p.attribute === 'color')

    expect(olive).toBeDefined()
    // Normalisation (trim + lowercase) is unchanged.
    expect(olive!.value).toBe('olive')
    expect(olive!.weight).toBeCloseTo(0.75, 5)
    expect(olive!.source).toBe('explicit')
    expect(olive!.signalCount).toBe(1)
    expect(stored.map((p) => p.attribute).sort()).toEqual(['color', 'fit'])
  })

  it('increments signal_count when a preference is submitted again', async () => {
    const { id } = await createTestUser(ctx.db, 'Repeat User')

    await upsertPreferences(ctx.db, id, [{ attribute: 'color', value: 'olive' }])
    await upsertPreferences(ctx.db, id, [{ attribute: 'color', value: 'olive' }])

    const [preference] = await listPreferences(ctx.db, id)
    expect(preference.signalCount).toBe(2)
  })

  it('survives a duplicate value inside one submission', async () => {
    const { id } = await createTestUser(ctx.db, 'Duplicate User')

    // Postgres rejects an ON CONFLICT DO UPDATE that touches a row twice in one
    // command, so the batch has to collapse duplicates before it is sent.
    const written = await upsertPreferences(ctx.db, id, [
      { attribute: 'color', value: 'olive' },
      { attribute: 'color', value: 'olive' },
    ])

    expect(written).toHaveLength(1)
    expect(await listPreferences(ctx.db, id)).toHaveLength(1)
  })

  it('discards values outside the controlled vocabulary without failing the batch', async () => {
    const { id } = await createTestUser(ctx.db, 'Mixed User')

    const written = await upsertPreferences(ctx.db, id, [
      { attribute: 'category', value: 'clothing' },
      { attribute: 'not_an_attribute', value: 'anything' },
      { attribute: 'color', value: '   ' },
    ])

    expect(written).toHaveLength(1)
    expect(written[0].value).toBe('clothing')
  })

  it('issues no statement at all when nothing survives validation', async () => {
    const { id } = await createTestUser(ctx.db, 'Empty User')
    const probe = counting(ctx.db)

    const written = await upsertPreferences(probe.db, id, [
      { attribute: 'not_an_attribute', value: 'anything' },
    ])

    expect(written).toEqual([])
    expect(probe.queries).toHaveLength(0)
  })

  it('keeps each user’s preferences to themselves', async () => {
    const mine = await createTestUser(ctx.db, 'Mine')
    const theirs = await createTestUser(ctx.db, 'Theirs')

    await upsertPreferences(ctx.db, mine.id, [{ attribute: 'color', value: 'olive' }])
    await upsertPreferences(ctx.db, theirs.id, [{ attribute: 'color', value: 'navy' }])

    expect((await listPreferences(ctx.db, mine.id)).map((p) => p.value)).toEqual(['olive'])
    expect((await listPreferences(ctx.db, theirs.id)).map((p) => p.value)).toEqual(['navy'])
  })
})

describe('upsertPreference (single-value wrapper)', () => {
  it('still returns the stored preference', async () => {
    const { id } = await createTestUser(ctx.db, 'Single User')

    const created = await upsertPreference(ctx.db, id, { attribute: 'color', value: 'olive' })

    expect(created).not.toBeNull()
    expect(created!.value).toBe('olive')
  })

  it('still returns null for a rejected input', async () => {
    const { id } = await createTestUser(ctx.db, 'Rejected User')

    expect(await upsertPreference(ctx.db, id, { attribute: 'nope', value: 'x' })).toBeNull()
  })
})
