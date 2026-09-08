import { Skeleton } from '@/components/ui/Skeleton'

/**
 * Route-level loading state.
 *
 * Mirrors the shape of a product grid so the layout does not jump when real
 * content arrives.
 */
export default function Loading() {
  return (
    <div className="space-y-6 py-2">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="aspect-4/5 w-full" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>

      <p className="sr-only" role="status">
        Loading products
      </p>
    </div>
  )
}
