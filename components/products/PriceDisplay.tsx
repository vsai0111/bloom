import { formatDiscount, formatMoney } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'

/**
 * Price with an optional original price.
 *
 * The struck-through original is only rendered when the normalizer accepted it
 * as trustworthy (see services/normalization/price.ts) — a strike-through is a
 * factual claim about what something used to cost, and a fabricated one is the
 * oldest trick in retail.
 */
export function PriceDisplay({
  price,
  originalPrice,
  currency,
  size = 'md',
  className,
}: {
  price: number
  originalPrice?: number | null
  currency: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const discounted = originalPrice !== null && originalPrice !== undefined && originalPrice > price
  const fraction = discounted ? (originalPrice - price) / originalPrice : 0

  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl',
  } as const

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
      <span className={cn('text-ink font-semibold', sizes[size])}>
        {formatMoney(price, currency)}
      </span>

      {discounted && (
        <>
          <span className="text-ink-subtle text-sm line-through">
            <span className="sr-only">Previously </span>
            {formatMoney(originalPrice, currency)}
          </span>
          <span className="text-positive text-xs font-medium">{formatDiscount(fraction)}</span>
        </>
      )}
    </div>
  )
}
