import type { SearchQuery, SearchResult } from '@/types/discovery'

/**
 * The search seam.
 *
 * Phase 1 uses PostgreSQL full-text search, which is genuinely sufficient at
 * this catalogue size and costs nothing extra to run. Introducing a dedicated
 * search engine before there is evidence it is needed would add a service to
 * operate, a sync pipeline to keep correct, and a monthly bill — for a
 * catalogue of a few thousand products.
 *
 * This interface exists so that decision stays reversible. Everything above it
 * deals in `SearchQuery` and `SearchResult`; nothing knows what is underneath.
 */
export interface SearchProvider {
  readonly id: string
  search(query: SearchQuery): Promise<SearchResult>
  /** Typeahead suggestions for the search box. */
  suggest(prefix: string, limit?: number): Promise<string[]>
}
