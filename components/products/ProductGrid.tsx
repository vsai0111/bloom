import type { ProductState } from '@/lib/engagement/repository'
import type { ProductSummary, RecommendedProduct } from '@/types/discovery'
import { ProductCard } from './ProductCard'

/**
 * Responsive product grid.
 *
 * Rendered as a list so assistive technology announces how many results there
 * are — a bare grid of divs gives no sense of size.
 */
export function ProductGrid({
  items,
  states,
  label,
}: {
  items: Array<ProductSummary | RecommendedProduct>
  states?: Map<string, ProductState>
  label: string
}) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"
    >
      {items.map((item, index) => (
        // The <li> is the grid item itself. `display: contents` would be the
        // tidier way to let the card be the grid child, but it drops the list
        // item from the accessibility tree in several browsers.
        <li key={item.product.id} className="flex">
          <ProductCard item={item} state={states?.get(item.product.id)} priority={index < 4} />
        </li>
      ))}
    </ul>
  )
}
