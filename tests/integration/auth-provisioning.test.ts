import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureProfile } from '@/lib/auth'
import { recordEvent } from '@/lib/analytics/events'
import { createTestDb, type TestDb } from '../helpers/db'

/**
 * Profile provisioning and the funnel events that depend on it.
 *
 * `user_events.user_id` references `profiles (id)`. Signup and first sign-in
 * both record an event for a user who has just been authenticated but has never
 * rendered a page, so the profile row did not exist yet and the insert died on
 * `user_events_user_id_fkey`. `recordEvent` swallows its errors by design, so
 * the only symptom was a funnel row that never arrived.
 *
 * These tests pin the ordering, and pin that the constraint itself is still
 * doing its job.
 */

let ctx: TestDb

beforeAll(async () => {
  ctx = await createTestDb({ seed: false })
})

afterAll(async () => {
  await ctx?.close()
})

function authUser() {
  return { id: randomUUID(), email: 'New.Person@example.com' }
}

describe('ensureProfile', () => {
  it('creates the profile row for a freshly authenticated user', async () => {
    const user = authUser()

    const profile = await ensureProfile(ctx.db, user)

    expect(profile.id).toBe(user.id)
    expect(profile.displayName).toBe('New Person')
    expect(profile.onboardingCompleted).toBe(false)
  })

  it('is idempotent, and does not clobber an existing profile', async () => {
    const user = authUser()

    await ensureProfile(ctx.db, user)
    await ctx.db.query(
      'update profiles set display_name = $2, onboarding_completed = true where id = $1',
      [user.id, 'Chosen Name'],
    )
    const second = await ensureProfile(ctx.db, user)

    expect(second.displayName).toBe('Chosen Name')
    expect(second.onboardingCompleted).toBe(true)

    const rows = await ctx.db.query('select id from profiles where id = $1', [user.id])
    expect(rows).toHaveLength(1)
  })
})

describe('funnel events for a newly authenticated user', () => {
  it('persists signup_completed once the profile is provisioned', async () => {
    const user = authUser()
    const sessionId = randomUUID()

    await ensureProfile(ctx.db, user)
    await recordEvent(ctx.db, { userId: user.id, sessionId, eventType: 'signup_completed' })

    const rows = await ctx.db.query<{ user_id: string; session_id: string }>(
      `select user_id, session_id from user_events
       where user_id = $1 and event_type = 'signup_completed'`,
      [user.id],
    )

    expect(rows).toHaveLength(1)
    // Event semantics preserved: still attributed to both user and session.
    expect(rows[0].user_id).toBe(user.id)
    expect(rows[0].session_id).toBe(sessionId)
  })

  it('persists signin_completed on a first sign-in', async () => {
    const user = authUser()

    await ensureProfile(ctx.db, user)
    await recordEvent(ctx.db, { userId: user.id, eventType: 'signin_completed' })

    const rows = await ctx.db.query(
      `select id from user_events where user_id = $1 and event_type = 'signin_completed'`,
      [user.id],
    )
    expect(rows).toHaveLength(1)
  })

  it('is silently dropped when the profile does not exist — the original bug', async () => {
    const orphan = randomUUID()

    // recordEvent never throws, so the loss is invisible to the caller. This is
    // why the failure only ever appeared in the database log.
    await recordEvent(ctx.db, { userId: orphan, eventType: 'signup_completed' })

    const rows = await ctx.db.query('select id from user_events where user_id = $1', [orphan])
    expect(rows).toHaveLength(0)
  })
})

describe('constraints are unchanged', () => {
  it('still enforces user_events_user_id_fkey', async () => {
    await expect(
      ctx.db.query(`insert into user_events (user_id, event_type) values ($1, 'product_view')`, [
        randomUUID(),
      ]),
    ).rejects.toThrow(/user_events_user_id_fkey/)
  })

  it('still allows anonymous events, which is why the column is nullable', async () => {
    const sessionId = randomUUID()
    await recordEvent(ctx.db, { sessionId, eventType: 'landing_view' })

    const rows = await ctx.db.query(
      `select id from user_events where session_id = $1 and user_id is null`,
      [sessionId],
    )
    expect(rows).toHaveLength(1)
  })

  it('keeps row-level security enabled on the tables involved', async () => {
    const rows = await ctx.db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('profiles', 'user_events')`,
    )

    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.relrowsecurity).toBe(true)
  })
})
