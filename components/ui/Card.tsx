import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

/** Surface container used for product cards, panels and empty states. */
export function Card({
  className,
  children,
  as: Tag = 'div',
}: {
  className?: string
  children: ReactNode
  as?: 'div' | 'article' | 'section' | 'li'
}) {
  return (
    <Tag className={cn('border-line bg-surface rounded-[var(--radius-card)] border', className)}>
      {children}
    </Tag>
  )
}
