import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { createPgliteHandle } from '@/lib/db/driver-pglite'
import { migrate } from '@/lib/db/migrate'
import { seedDatabase } from '@/services/ingestion/seed-runner'
import type { DbHandle } from '@/lib/db/types'

/**
 * Integration-test database.
 *
 * Each call builds a fresh in-memory PostgreSQL, applies the real migrations and
 * runs the real seed pipeline. Tests therefore exercise actual SQL — indexes,
 * constraints, window functions, full-text search — rather than a mock that
 * would happily agree with a broken query.
 *
 * The clock is pinned so seeded price histories, and every deal score derived
 * from them, are identical on every run.
 */

export const TEST_NOW = new Date('2026-06-01T12:00:00.000Z')

export interface TestDb {
  db: DbHandle
  close: () => Promise<void>
}

export async function createTestDb(
  options: { seed?: boolean; limit?: number } = {},
): Promise<TestDb> {
  // File-backed rather than in-memory: PGlite keeps an in-memory database
  // entirely inside the WASM heap, and a full seeded catalogue (~3k price rows
  // plus indexes) exhausts it. On disk it pages normally and stays well within
  // budget. The directory is unique per call and removed on close, so tests
  // remain isolated from each other.
  const dataDir = path.join('.bloom', `test-${randomBytes(6).toString('hex')}`)

  const db = await createPgliteHandle(dataDir)
  await migrate(db)

  if (options.seed !== false) {
    await seedDatabase(db, { now: TEST_NOW, limit: options.limit })
  }

  return {
    db,
    close: async () => {
      await db.close()
      await rm(dataDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/** Insert a profile directly, bypassing auth, for tests that need a user. */
export async function createTestUser(
  db: DbHandle,
  displayName = 'Test User',
): Promise<{ id: string }> {
  const rows = await db.query<{ id: string }>(
    `insert into profiles (id, display_name) values (gen_random_uuid(), $1) returning id`,
    [displayName],
  )
  return { id: rows[0].id }
}
