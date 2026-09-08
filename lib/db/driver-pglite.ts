import 'server-only'
import { resolvePgliteDataDir } from './data-dir'
import type { Db, DbHandle } from './types'

/**
 * Embedded PostgreSQL (PGlite, PostgreSQL 18 compiled to WASM).
 *
 * Used for local development, unit/integration tests and E2E runs, so that the
 * whole product is exercisable without Docker, a database server, or any
 * credentials. It is a genuine Postgres: RLS, generated tsvector columns, GIN
 * indexes and exact `numeric` arithmetic all behave as they do in production.
 *
 * Not intended for production use — it is a single-process, single-connection
 * database.
 */

type PGliteLike = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(text: string): Promise<unknown>
  transaction<T>(fn: (tx: PGliteTx) => Promise<T>): Promise<T>
  close(): Promise<void>
}

type PGliteTx = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
  exec(text: string): Promise<unknown>
}

function wrapTx(tx: PGliteTx): Db {
  return {
    async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await tx.query<T>(text, params as unknown[])
      return result.rows
    },
    async exec(text: string) {
      await tx.exec(text)
    },
    async transaction<T>(fn: (inner: Db) => Promise<T>): Promise<T> {
      // Already inside a transaction; PGlite has no nested transactions, and
      // reusing the same scope keeps callers atomic as they expect.
      return fn(wrapTx(tx))
    },
  }
}

export async function createPgliteHandle(dataDir: string): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite')

  // Never `mkdir` the configured value directly: a relative path resolves
  // against `process.cwd()`, which is the read-only bundle root under a
  // serverless runtime. See lib/db/data-dir.ts.
  const { dir } = resolvePgliteDataDir(dataDir)

  if (dir) {
    // PGlite does not create intermediate directories for its data dir.
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
  }

  const client = (await PGlite.create({
    dataDir: dir ?? undefined,
  })) as unknown as PGliteLike

  return {
    driver: 'pglite',
    async query<T>(text: string, params: readonly unknown[] = []) {
      const result = await client.query<T>(text, params as unknown[])
      return result.rows
    },
    async exec(text: string) {
      await client.exec(text)
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return client.transaction((tx) => fn(wrapTx(tx)))
    },
    async close() {
      await client.close()
    },
  }
}
