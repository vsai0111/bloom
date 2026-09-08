import type { ReactNode } from 'react'

/**
 * Empty state.
 *
 * Every empty surface says what happened and what to do next. "No results"
 * with no route forward is a dead end, and dead ends are where users leave.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="border-line-strong flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed px-6 py-14 text-center">
      <h2 className="text-ink text-base font-semibold">{title}</h2>
      {description && <p className="text-ink-muted mt-1.5 max-w-md text-sm">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
