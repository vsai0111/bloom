import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted border-line',
  accent: 'bg-accent-soft text-accent-strong border-transparent',
  positive: 'bg-accent-soft text-positive border-transparent',
  negative: 'bg-surface-sunken text-negative border-line',
  warning: 'bg-surface-sunken text-warning border-line',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: BadgeTone
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
