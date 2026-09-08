import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, createTestUser, type TestDb } from '../helpers/db'

/**
 * Row-level security.
 *
 * These tests matter because RLS is what makes Supabase's *public* anon key safe
 * to ship in the browser bundle. Without them, "we enabled RLS" is an
 * unverified claim — and a policy with a subtly wrong USING clause looks
 * identical to a correct one until someone reads another user's data.
 *
 * Each test assumes the `authenticated` role and sets `app.user_id`, which is
 * exactly what `bloom_current_user_id()` reads. Bloom's own server connects as
 * a trusted role that bypasses RLS, so these exercise the client-key path.
 */
describe('row level security', () => {
  let context: TestDb
  let alice: string
  let bob: string

  beforeAll(async () => {
    context = await createTestDb({ seed: false })

    alice = (await createTestUser(context.db, 'Alice')).id
    bob = (await createTestUser(context.db, 'Bob')).id

    // A product to attach user rows to.
    await context.db.query(
      `insert into products (id, canonical_title, brand, category, match_key)
       values ('33333333-3333-3333-3333-333333333333', 'Test', 'Aera', 'clothing', 'title:aera:test')`,
    )

    for (const userId of [alice, bob]) {
      await context.db.query(
        `insert into saved_products (user_id, product_id)
         values ($1, '33333333-3333-3333-3333-333333333333')`,
        [userId],
      )
      await context.db.query(
        `insert into user_preferences (user_id, attribute, value, weight, source)
         values ($1, 'color', $2, 0.9, 'explicit')`,
        [userId, userId === alice ? 'olive' : 'navy'],
      )
    }

    // The client-facing roles need table privileges as well as passing policies.
    await context.db.exec(`
      grant usage on schema public to authenticated, anon;
      grant select, insert, update, delete on saved_products, user_preferences to authenticated;
      grant select on products to authenticated, anon;
    `)
  }, 120_000)

  afterAll(async () => {
    await context?.close()
  })

  /** Run a query as `authenticated`, with `app.user_id` bound to `userId`. */
  async function asUser<T = Record<string, unknown>>(
    userId: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return context.db.transaction(async (tx) => {
      await tx.query('select set_config($1, $2, true)', ['app.user_id', userId ?? ''])
      await tx.exec('set local role authenticated')
      return tx.query<T>(sql, params)
    })
  }

  it('shows a user only their own saved products', async () => {
    const aliceRows = await asUser(alice, 'select user_id from saved_products')
    expect(aliceRows).toHaveLength(1)
    expect(aliceRows[0].user_id).toBe(alice)

    const bobRows = await asUser(bob, 'select user_id from saved_products')
    expect(bobRows).toHaveLength(1)
    expect(bobRows[0].user_id).toBe(bob)
  })

  it('hides another user rows even when they are asked for by id', async () => {
    // The direct-object-reference attempt: name Bob's row explicitly as Alice.
    const rows = await asUser(alice, 'select * from saved_products where user_id = $1', [bob])
    expect(rows).toEqual([])
  })

  it('shows a user only their own preferences', async () => {
    const rows = await asUser<{ value: string }>(alice, 'select value from user_preferences')
    expect(rows.map((r) => r.value)).toEqual(['olive'])
  })

  it('refuses to let a user write a row owned by someone else', async () => {
    await expect(
      asUser(
        alice,
        `insert into user_preferences (user_id, attribute, value, weight, source)
         values ($1, 'color', 'red', 0.5, 'explicit')`,
        [bob],
      ),
    ).rejects.toThrow(/row-level security|violates/i)
  })

  it('refuses to let a user delete another user rows', async () => {
    await asUser(alice, 'delete from saved_products where user_id = $1', [bob])

    // Bob's row must still be there.
    const rows = await context.db.query('select user_id from saved_products where user_id = $1', [
      bob,
    ])
    expect(rows).toHaveLength(1)
  })

  it('returns nothing at all for an unauthenticated session', async () => {
    const rows = await asUser(null, 'select * from saved_products')
    expect(rows).toEqual([])
  })

  it('still exposes the public catalogue to anonymous readers', async () => {
    const rows = await context.db.transaction(async (tx) => {
      await tx.exec('set local role anon')
      return tx.query('select id from products')
    })
    expect(rows.length).toBeGreaterThan(0)
  })

  it('never exposes the credentials table to any client role', async () => {
    for (const role of ['anon', 'authenticated']) {
      await expect(
        context.db.transaction(async (tx) => {
          await tx.exec(`set local role ${role}`)
          return tx.query('select * from local_auth_users')
        }),
      ).rejects.toThrow(/permission denied/i)
    }
  })

  it('has RLS enabled on every table holding user data', async () => {
    const rows = await context.db.query<{ tablename: string }>(
      `select c.relname as tablename
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relrowsecurity = false
          and c.relname in (
            'profiles', 'user_preferences', 'saved_products', 'product_likes',
            'product_rejections', 'user_events', 'affiliate_clicks', 'local_auth_users'
          )`,
    )
    expect(rows.map((r) => r.tablename)).toEqual([])
  })
})
