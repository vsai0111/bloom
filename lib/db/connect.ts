import 'server-only'
import { resolveDbDriver, serverEnv } from '@/config/env.server'
import { logger } from '@/lib/logging/logger'
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

  logger.info('starting embedded postgres (pglite)', { dataDir: env.PGLITE_DATA_DIR })
  return createPgliteHandle(env.PGLITE_DATA_DIR)
}
