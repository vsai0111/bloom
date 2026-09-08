import type { OfferSummary } from '@/types/catalog'
import { formatMoney, humanize } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'

const AVAILABILITY_LABEL: Record<string, string> = {
  in_stock: 'In stock',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  discontinued: 'Discontinued',
}

/**
 * Merchant comparison.
 *
 * Renders every known offer with its price and availability. Deliberately makes
 * no "best price" claim: Bloom only knows the merchants it has ingested, and
 * claiming a global lowest price from a partial view would be false.
 */
export function OfferList({
  offers,
  highlightId,
}: {
  offers: readonly OfferSummary[]
  highlightId?: string
}) {
  return (
    <ul className="divide-line border-line bg-surface divide-y overflow-hidden rounded-[var(--radius-card)] border">
      {offers.map((offer) => {
        const buyable = offer.availability === 'in_stock' || offer.availability === 'low_stock'

        return (
          <li
            key={offer.id}
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 p-4',
              offer.id === highlightId && 'bg-accent-soft/40',
            )}
          >
            <div className="min-w-0">
              <p className="text-ink font-medium">{offer.merchantName}</p>
              <p className="text-ink-subtle text-xs">
                {AVAILABILITY_LABEL[offer.availability] ?? humanize(offer.availability)}
                {offer.id === highlightId && ' · shown above'}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-ink font-semibold">
                  {formatMoney(offer.currentPrice, offer.currency)}
                </p>
                {offer.originalPrice && offer.originalPrice > offer.currentPrice && (
                  <p className="text-ink-subtle text-xs line-through">
                    {formatMoney(offer.originalPrice, offer.currency)}
                  </p>
                )}
              </div>

              <a
                href={`/go/${offer.id}`}
                rel="nofollow sponsored noopener"
                target="_blank"
                className={cn(
                  'inline-flex h-10 items-center rounded-[var(--radius-control)] border px-4 text-sm font-medium',
                  buyable
                    ? 'border-line-strong text-ink hover:bg-surface-sunken'
                    : 'border-line text-ink-subtle pointer-events-none opacity-60',
                )}
                aria-disabled={!buyable}
              >
                {buyable ? 'Visit' : 'Unavailable'}
                {buyable && (
                  <span className="sr-only"> {offer.merchantName} (opens in a new tab)</span>
                )}
              </a>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
