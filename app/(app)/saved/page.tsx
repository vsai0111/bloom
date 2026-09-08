import { requireUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { listSavedProducts, loadProductStates } from '@/lib/engagement/repository'
import { formatMoney, formatRelativeTime } from '@/lib/utils/format'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProductCard } from '@/components/products/ProductCard'

export const metadata = { title: 'Saved' }

/**
 * Saved products, with price movement since the moment each was saved.
 *
 * This is the one place Bloom can make a genuinely personal price statement:
 * it compares against the price this user actually saw, not a market average.
 */
export default async function SavedPage() {
  const session = await requireUser('/saved')
  const db = await getDb()

  const entries = await listSavedProducts(db, session.id)
  const states = await loadProductStates(
    db,
    session.id,
    entries.map((entry) => entry.summary.product.id),
  )

  const cheaper = entries.filter((entry) => entry.priceChange !== null && entry.priceChange < 0)

  return (
    <div className="space-y-6 py-2">
      <header>
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Saved</h1>
        <p className="text-ink-muted mt-1 text-sm">
          {entries.length === 0
            ? 'Things you save are kept here, and we watch their prices for you.'
            : cheaper.length > 0
              ? `${cheaper.length} of your ${entries.length} saved item${entries.length === 1 ? '' : 's'} ${cheaper.length === 1 ? 'is' : 'are'} cheaper than when you saved ${cheaper.length === 1 ? 'it' : 'them'}.`
              : `${entries.length} item${entries.length === 1 ? '' : 's'}. None have dropped in price since you saved them.`}
        </p>
      </header>

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          description="Save anything you are considering and Bloom will track its price and tell you when it moves."
          action={<ButtonLink href="/home">Back to your feed</ButtonLink>}
        />
      ) : (
        <ul
          aria-label="Saved products"
          className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"
        >
          {entries.map((entry) => (
            <li key={entry.summary.product.id} className="flex flex-col">
              <ProductCard item={entry.summary} state={states.get(entry.summary.product.id)} />

              <p className="text-ink-subtle mt-1.5 px-1 text-xs">
                Saved {formatRelativeTime(entry.savedAt)}
                {entry.priceChange !== null && entry.priceChange !== 0 && (
                  <>
                    {' · '}
                    <span
                      className={
                        entry.priceChange < 0 ? 'text-positive font-medium' : 'text-ink-muted'
                      }
                    >
                      {entry.priceChange < 0 ? '↓ ' : '↑ '}
                      {formatMoney(Math.abs(entry.priceChange), entry.summary.offer.currency)}
                      {entry.priceChange < 0 ? ' cheaper' : ' dearer'}
                    </span>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
