/**
 * The database seam.
 *
 * Everything above this interface writes ordinary parameterised SQL and does
 * not know whether it is talking to Supabase Postgres over the network or to
 * the embedded PGlite instance used for development and tests. Both are real
 * PostgreSQL, so the same migrations, indexes, RLS policies and queries run
 * against either.
 */
export interface Db {
  /** Run a parameterised query using `$1`-style placeholders. */
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>

  /** Run one or more statements with no parameters (migrations, DDL). */
  exec(text: string): Promise<void>

  /** Run `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>
}

/** A pooled/owned connection that can be shut down. */
export interface DbHandle extends Db {
  close(): Promise<void>
  readonly driver: 'postgres' | 'pglite'
}

/** Convenience: first row or null. */
export async function queryOne<T = Record<string, unknown>>(
  db: Db,
  text: string,
  params?: readonly unknown[],
): Promise<T | null> {
  const rows = await db.query<T>(text, params)
  return rows[0] ?? null
}
