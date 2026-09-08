import Link from 'next/link'
import { cn } from '@/lib/utils/cn'

/**
 * Pagination.
 *
 * Real links rather than buttons, so pages can be opened in a new tab, indexed
 * and bookmarked. The current page is marked with aria-current.
 */
export function SearchPagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number
  pageSize: number
  total: number
  hrefFor: (page: number) => string
}) {
  const pageCount = Math.ceil(total / pageSize)
  if (pageCount <= 1) return null

  // A sliding window of at most five pages, clamped to the available range.
  const start = Math.max(1, Math.min(page - 2, pageCount - 4))
  const end = Math.min(pageCount, start + 4)
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index)

  const linkClass =
    'inline-flex h-10 min-w-10 items-center justify-center rounded-[var(--radius-control)] border px-3 text-sm'

  return (
    <nav aria-label="Search results pages" className="mt-8 flex flex-wrap items-center gap-2">
      {page > 1 && (
        <Link
          href={hrefFor(page - 1)}
          rel="prev"
          className={cn(linkClass, 'border-line-strong text-ink hover:bg-surface-sunken')}
        >
          Previous
        </Link>
      )}

      {pages.map((candidate) => (
        <Link
          key={candidate}
          href={hrefFor(candidate)}
          aria-current={candidate === page ? 'page' : undefined}
          className={cn(
            linkClass,
            candidate === page
              ? 'border-accent bg-accent-soft text-accent-strong font-medium'
              : 'border-line-strong text-ink hover:bg-surface-sunken',
          )}
        >
          <span className="sr-only">Page </span>
          {candidate}
        </Link>
      ))}

      {page < pageCount && (
        <Link
          href={hrefFor(page + 1)}
          rel="next"
          className={cn(linkClass, 'border-line-strong text-ink hover:bg-surface-sunken')}
        >
          Next
        </Link>
      )}
    </nav>
  )
}
