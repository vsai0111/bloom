import 'server-only'
import type { Db } from '@/lib/db/types'
import { PostgresSearchProvider } from './postgres-provider'
import type { SearchProvider } from './types'

export type { SearchProvider } from './types'

/**
 * Resolve the active search provider.
 *
 * One place to change when a dedicated search engine is introduced. Until there
 * is evidence Postgres is insufficient, this returns the Postgres provider —
 * see docs/decisions.md, ADR-0005.
 */
export function getSearchProvider(db: Db): SearchProvider {
  return new PostgresSearchProvider(db)
}
