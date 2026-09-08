import 'server-only'
import type { Db, DbHandle } from './types'

/**
 * Remote PostgreSQL (Supabase in production).
 *
 * Uses `postgres` in "unsafe" mode only for the *text* of already-authored SQL;
 * every user-supplied value still travels as a bound parameter, so this is not
 * a SQL-injection seam. Query text is never assembled from user input — see
 * lib/search/query-builder.ts for how filters are parameterised.
 */

type PostgresSql = {
  unsafe(text: string, params?: unknown[]): Promise<unknown[]> & { values(): Promise<unknown[]> }
  begin<T>(fn: (tx: PostgresSql) => Promise<T>): Promise<T>
  end(opts?: { timeout?: number }): Promise<void>
}

function wrap(sql: PostgresSql): Db {
  return {
    async query<T>(text: string, params: readonly unknown[] = []) {
      const rows = await sql.unsafe(text, params as unknown[])
      return rows as T[]
    },
    async exec(text: string) {
      await sql.unsafe(text)
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return sql.begin((tx) => fn(wrap(tx)))
    },
  }
}

export async function createPostgresHandle(connectionString: string): Promise<DbHandle> {
  const { default: postgres } = await import('postgres')

  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 15,
    // Supabase's pooler does not support prepared statements in transaction mode.
    prepare: false,
    onnotice: () => {},
  }) as unknown as PostgresSql

  const base = wrap(sql)

  return {
    driver: 'postgres',
    query: base.query,
    exec: base.exec,
    transaction: base.transaction,
    async close() {
      await sql.end({ timeout: 5 })
    },
  }
}
