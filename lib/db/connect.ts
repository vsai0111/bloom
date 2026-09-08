import 'server-only'
import { resolveDbDriver, serverEnv } from '@/config/env.server'
import { logger } from '@/lib/logging/logger'
import { resolvePgliteDataDir } from './data-dir'
import { createPgliteHandle } from './driver-pglite'
import { createPostgresHandle } from './driver-postgres'
import type { DbHandle } from './types'

/**
 * Open a database connection, with no side effects beyond connecting.
 *
 * Kept separate from `getDb()` so CLI scripts and tests can obtain a raw handle
 * without triggering the development bootstrap (migrate + seed) that the
 * application path performs for the embedded database.
 */
export async function createDbHandle(): Promise<DbHandle> {
  const env = serverEnv()
  const driver = resolveDbDriver()

  if (driver === 'postgres') {
    if (!env.DATABASE_URL) {
      throw new Error(
        'BLOOM_DB_DRIVER resolved to "postgres" but DATABASE_URL is not set. ' +
          'Set DATABASE_URL, or set BLOOM_DB_DRIVER=pglite to use the embedded database.',
      )
    }
    logger.info('connecting to postgres')
    return createPostgresHandle(env.DATABASE_URL)
  }

  const { dir, ephemeral } = resolvePgliteDataDir(env.PGLITE_DATA_DIR)

  if (env.NODE_ENV === 'production') {
    // Not an error — a deployment with no DATABASE_URL is still expected to
    // serve — but it must never be mistaken for a durable database.
    logger.warn(
      'production is running on the embedded database; state is per-instance and is lost when the instance is recycled. Set DATABASE_URL to use Postgres.',
      { dataDir: dir ?? 'memory://', ephemeral },
    )
  }

  logger.info('starting embedded postgres (pglite)', {
    configured: env.PGLITE_DATA_DIR,
    dataDir: dir ?? 'memory://',
    ephemeral,
  })
  return createPgliteHandle(env.PGLITE_DATA_DIR)
}
