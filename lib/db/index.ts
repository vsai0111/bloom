import 'server-only'
import { resolveDbDriver } from '@/config/env.server'
import { logger } from '@/lib/logging/logger'
import { createDbHandle } from './connect'
import type { Db, DbHandle } from './types'

export type { Db, DbHandle } from './types'
export { queryOne } from './types'
export { createDbHandle } from './connect'

/**
 * Process-wide database handle.
 *
 * Held on `globalThis` so Next.js dev-server hot reloads reuse one connection
 * pool (and one PGlite instance) instead of leaking a new one per reload.
 */
declare global {
  var __bloomDb: Promise<DbHandle> | undefined
}

async function connect(): Promise<DbHandle> {
  const handle = await createDbHandle()
  if (handle.driver === 'pglite') await bootstrapEmbedded(handle)
  return handle
}

/**
 * Make the embedded database usable on first run.
 *
 * Only ever runs for PGlite — a development/test database that starts empty, so
 * that `npm run dev` works immediately after a clone with no setup step. A
 * remote Postgres is migrated explicitly via `npm run db:migrate` and is never
 * modified implicitly at request time.
 */
async function bootstrapEmbedded(db: DbHandle): Promise<void> {
  const { migrate, isMigrated } = await import('./migrate')
  const wasSetUp = await isMigrated(db)
  const { applied } = await migrate(db)

  if (!wasSetUp || applied.length > 0) {
    const { seedDatabase } = await import('@/services/ingestion/seed-runner')
    const summary = await seedDatabase(db)
    logger.info('embedded database seeded', { ...summary })
  }
}

/** Get the shared database handle, connecting on first use. */
export function getDb(): Promise<DbHandle> {
  if (!globalThis.__bloomDb) {
    globalThis.__bloomDb = connect().catch((error: unknown) => {
      // Never cache a failed connection: the next request should retry.
      globalThis.__bloomDb = undefined
      throw error
    })
  }
  return globalThis.__bloomDb
}

/** Close and forget the shared handle. Used by tests and shutdown paths. */
export async function closeDb(): Promise<void> {
  const pending = globalThis.__bloomDb
  globalThis.__bloomDb = undefined
  if (!pending) return
  try {
    const handle = await pending
    await handle.close()
  } catch (error) {
    logger.warn('error closing database', { error })
  }
}

/** Which driver the current configuration resolves to. */
export function currentDriver(): 'postgres' | 'pglite' {
  return resolveDbDriver()
}

/**
 * Run `fn` with the Postgres session bound to `userId`, so row-level security
 * policies evaluate against that user.
 *
 * Note this is defence in depth, not the primary control: Bloom's server
 * connects as a trusted role that RLS does not constrain, so repository queries
 * additionally scope by `user_id` explicitly. See docs/database.md.
 */
export async function withUserContext<T>(
  db: Db,
  userId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query('select set_config($1, $2, true)', ['app.user_id', userId])
    return fn(tx)
  })
}
