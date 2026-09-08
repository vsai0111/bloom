import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { loadProductStates, recordProductView } from '@/lib/engagement/repository'
import { listActivePreferences } from '@/lib/preferences/repository'
import { loadProductDetail } from '@/lib/products/repository'
import { scoreProduct } from '@/lib/recommendations/scoring'
import { formatMoney, humanize } from '@/lib/utils/format'
import { Badge } from '@/components/ui/Badge'
import { DealExplanation } from '@/components/products/DealExplanation'
import { PriceDisplay } from '@/components/products/PriceDisplay'
import { PriceHistoryChart } from '@/components/products/PriceHistoryChart'
import { ProductActions } from '@/components/products/ProductActions'
import { ProductImage } from '@/components/products/ProductImage'
import { PreferenceMatchPanel } from '@/components/products/PreferenceMatchPanel'
import { OfferList } from '@/components/products/OfferList'

const idSchema = z.string().uuid()

export async function generateMetadata({ params }: PageProps<'/product/[id]'>) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) return { title: 'Product' }

  const db = await getDb()
  const detail = await loadProductDetail(db, id)
  if (!detail) return { title: 'Product not found' }

  return {
    title: `${detail.product.brand} ${detail.product.canonicalTitle}`,
    description: detail.product.description ?? undefined,
  }
}

export default async function ProductPage({ params }: PageProps<'/product/[id]'>) {
  const session = await requireUser()
  const { id } = await params

  // An id that is not a UUID never reaches the database.
  if (!idSchema.safeParse(id).success) notFound()

  const db = await getDb()
  const detail = await loadProductDetail(db, id)
  if (!detail) notFound()

  const [preferences, states] = await Promise.all([
    listActivePreferences(db, session.id),
    loadProductStates(db, session.id, [id]),
  ])

  const score = scoreProduct(detail, preferences)

  await Promise.all([
    recordEvent(db, {
      userId: session.id,
      eventType: 'product_viewed',
      productId: id,
      merchantProductId: detail.offer.id,
      metadata: { dealScore: detail.deal.score, matchScore: score.total },
    }),
    recordProductView(db, session.id, id),
  ])

  const { product, offer } = detail
  const attributes = Object.entries(product.attributes).filter(([, value]) => Boolean(value))

  return (
    <article className="py-2">
      <div className="grid gap-8 lg:grid-cols-2">
        {/* --- Imagery --- */}
        <div className="border-line bg-surface-sunken relative aspect-4/5 overflow-hidden rounded-[var(--radius-card)] border">
          <ProductImage
            src={detail.imageUrl}
            alt={`${product.brand} ${product.canonicalTitle}`}
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
          />
        </div>

        {/* --- Summary --- */}
        <div>
          <p className="text-ink-subtle text-sm font-medium tracking-wide uppercase">
            {product.brand}
          </p>
          <h1 className="text-ink mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {product.canonicalTitle}
          </h1>

          <div className="mt-4">
            <PriceDisplay
              price={offer.currentPrice}
              originalPrice={offer.originalPrice}
              currency={offer.currency}
              size="lg"
            />
            <p className="text-ink-muted mt-1 text-sm">
              at {offer.merchantName}
              {detail.offerCount > 1 && ` · ${detail.offerCount} merchants stock this`}
            </p>
          </div>

          {product.description && (
            <p className="text-ink-muted mt-5 text-sm leading-relaxed">{product.description}</p>
          )}

          {attributes.length > 0 && (
            <div className="mt-5">
              <h2 className="sr-only">Product attributes</h2>
              <ul className="flex flex-wrap gap-2">
                {attributes.map(([key, value]) => (
                  <li key={key}>
                    <Badge>
                      <span className="text-ink-subtle">{humanize(key)}:</span> {humanize(value!)}
                    </Badge>
                  </li>
                ))}
                {product.subcategory && (
                  <li>
                    <Badge>{humanize(product.subcategory)}</Badge>
                  </li>
                )}
              </ul>
            </div>
          )}

          {detail.variants.length > 0 && (
            <div className="mt-5">
              <h2 className="text-ink text-sm font-medium">Available sizes</h2>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {detail.variants
                  .filter((variant) => variant.size)
                  .map((variant) => (
                    <li
                      key={variant.id}
                      className="border-line text-ink-muted rounded border px-2.5 py-1 text-xs"
                    >
                      {variant.size}
                    </li>
                  ))}
              </ul>
              <p className="text-ink-subtle mt-2 text-xs">
                Size availability is confirmed on the merchant&apos;s own page.
              </p>
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-4">
            {/*
              A plain link, not a fetch: it must be middle-clickable and
              openable in a new tab like any other outbound link. The route
              records the click, then redirects.
            */}
            <a
              href={`/go/${offer.id}`}
              rel="nofollow sponsored noopener"
              target="_blank"
              className="bg-accent text-accent-ink hover:bg-accent-strong inline-flex h-12 items-center justify-center rounded-[var(--radius-control)] px-6 text-base font-medium"
            >
              Buy at {offer.merchantName}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>

            <ProductActions
              productId={product.id}
              productTitle={`${product.brand} ${product.canonicalTitle}`}
              initialState={
                states.get(product.id) ?? { saved: false, liked: false, rejected: false }
              }
            />
          </div>

          <p className="text-ink-subtle mt-3 text-xs">
            Bloom may earn a commission on purchases made through this link. It does not change the
            price you pay or how this product was ranked.
          </p>
        </div>
      </div>

      {/* --- Intelligence --- */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <DealExplanation deal={detail.deal} />
        <PreferenceMatchPanel score={score} hasPreferences={preferences.length > 0} />
      </div>

      <section
        aria-labelledby="history-heading"
        className="border-line bg-surface mt-6 rounded-[var(--radius-card)] border p-5"
      >
        <h2 id="history-heading" className="text-ink text-base font-semibold">
          Price history at {offer.merchantName}
        </h2>
        <p className="text-ink-muted mt-1 text-sm">
          Every price we have recorded for this listing. Currently{' '}
          {formatMoney(offer.currentPrice, offer.currency)}.
        </p>
        <div className="mt-4">
          <PriceHistoryChart points={detail.priceHistory} currency={offer.currency} />
        </div>
      </section>

      {detail.offers.length > 1 && (
        <section aria-labelledby="offers-heading" className="mt-6">
          <h2 id="offers-heading" className="text-ink text-base font-semibold">
            Where you can buy it
          </h2>
          <p className="text-ink-muted mt-1 text-sm">
            All merchants we know stock this product, cheapest available first.
          </p>
          <div className="mt-4">
            <OfferList offers={detail.offers} highlightId={offer.id} />
          </div>
        </section>
      )}
    </article>
  )
}
