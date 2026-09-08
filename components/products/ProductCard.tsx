import Link from 'next/link'
import type { ProductState } from '@/lib/engagement/repository'
import type { ProductSummary, RecommendedProduct } from '@/types/discovery'
import { humanize } from '@/lib/utils/format'
import { Card } from '@/components/ui/Card'
import { DealBadge } from './DealBadge'
import { PriceDisplay } from './PriceDisplay'
import { ProductActions } from './ProductActions'
import { ProductImage } from './ProductImage'

/**
 * A product card.
 *
 * The whole card is not a single link: the title is the link, and the action
 * buttons sit outside it. Nesting buttons inside an anchor is invalid HTML and
 * makes both keyboard and screen-reader interaction ambiguous. A stretched
 * pseudo-element gives the card a large click target while keeping exactly one
 * focusable link per card.
 */
export function ProductCard({
  item,
  state,
  priority = false,
}: {
  item: ProductSummary | RecommendedProduct
  state?: ProductState
  priority?: boolean
}) {
  const { product, offer, deal, offerCount } = item
  const explanations = 'explanations' in item ? item.explanations : []
  const outOfStock = offer.availability === 'out_of_stock' || offer.availability === 'discontinued'

  return (
    <Card as="article" className="group relative flex w-full flex-col overflow-hidden">
      <div className="bg-surface-sunken relative aspect-4/5 overflow-hidden">
        <ProductImage
          src={item.imageUrl}
          alt={`${product.brand} ${product.canonicalTitle}`}
          priority={priority}
        />

        {outOfStock && (
          <div className="bg-surface/70 absolute inset-0 flex items-center justify-center">
            <span className="bg-surface text-ink-muted rounded-full px-3 py-1 text-xs font-medium">
              Out of stock
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-ink-subtle text-xs font-medium tracking-wide uppercase">
            {product.brand}
          </p>
          <DealBadge deal={deal} />
        </div>

        <h3 className="text-ink text-sm leading-snug font-medium">
          <Link
            href={`/product/${product.id}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {product.canonicalTitle}
          </Link>
        </h3>

        <PriceDisplay
          price={offer.currentPrice}
          originalPrice={offer.originalPrice}
          currency={offer.currency}
        />

        {explanations.length > 0 && (
          <p className="text-ink-muted text-xs leading-relaxed">{explanations[0]}</p>
        )}

        <p className="text-ink-subtle mt-auto pt-1 text-xs">
          {offerCount > 1 ? `${offerCount} merchants` : offer.merchantName}
          {product.subcategory ? ` · ${humanize(product.subcategory)}` : ''}
        </p>
      </div>

      {state && (
        // z-10 lifts the controls above the card-wide stretched link overlay.
        <div className="border-line relative z-10 border-t px-3.5 py-2">
          <ProductActions
            productId={product.id}
            productTitle={`${product.brand} ${product.canonicalTitle}`}
            initialState={state}
            compact
          />
        </div>
      )}
    </Card>
  )
}
