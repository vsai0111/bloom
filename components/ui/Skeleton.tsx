import { cn } from '@/lib/utils/cn'

/** Loading placeholder. Marked aria-hidden so it is not announced as content. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('bg-surface-sunken animate-pulse rounded', className)} />
  )
}
