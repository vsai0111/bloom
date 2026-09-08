import { requireUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { loadProductStates } from '@/lib/engagement/repository'
import { getSearchProvider } from '@/lib/search'
import { buildSearchHref, parseSearchParams } from '@/lib/search/query-params'
import { EmptyState } from '@/components/ui/EmptyState'
import { ButtonLink } from '@/components/ui/Button'
import { ProductGrid } from '@/components/products/ProductGrid'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchFilters } from '@/components/search/SearchFilters'
import { SearchPagination } from '@/components/search/SearchPagination'

export const metadata = { title: 'Search' }

/**
 * Search.
 *
 * Entirely server-rendered and driven by the query string, so every result page
 * is linkable, shareable and back-button friendly, and works without client
 * JavaScript. Filters are plain form submissions for the same reason.
 */
export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const session = await requireUser('/search')
  const params = await searchParams

  const query = parseSearchParams(params)
  const db = await getDb()

  const hasQuery = Boolean(query.text) || Object.values(query.filters ?? {}).some(Boolean)

  if (hasQuery) {
    await recordEvent(db, {
      userId: session.id,
      eventType: 'search_started',
      metadata: { q: query.text ?? '', sort: query.sort ?? 'relevance' },
    })
  }

  const results = await getSearchProvider(db).search(query)

  if (hasQuery) {
    await recordEvent(db, {
      userId: session.id,
      eventType: 'search_completed',
      metadata: { q: query.text ?? '', results: results.total, page: results.page },
    })
  }

  const states = await loadProductStates(
    db,
    session.id,
    results.items.map((item) => item.product.id),
  )

  const from = (results.page - 1) * results.pageSize + 1
  const to = Math.min(results.page * results.pageSize, results.total)

  return (
    <div className="py-2">
      <h1 className="sr-only">Search products</h1>

      <SearchBar defaultValue={query.text ?? ''} query={query} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <SearchFilters query={query} facets={results.facets} priceBounds={results.priceBounds} />

        <div>
          {/* Announced politely so result counts reach screen readers on update. */}
          <p role="status" aria-live="polite" className="text-ink-muted mb-4 text-sm">
            {results.total === 0
              ? 'No matching products'
              : `${results.total} product${results.total === 1 ? '' : 's'} · showing ${from}–${to}`}
          </p>

          {results.items.length === 0 ? (
            <EmptyState
              title="Nothing matched that"
              description="Try fewer filters, a broader term, or browse everything in the catalogue."
              action={
                <ButtonLink href="/search" variant="secondary">
                  Clear search and filters
                </ButtonLink>
              }
            />
          ) : (
            <>
              <ProductGrid items={results.items} states={states} label="Search results" />
              <SearchPagination
                page={results.page}
                pageSize={results.pageSize}
                total={results.total}
                hrefFor={(page) => buildSearchHref(query, { page })}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
