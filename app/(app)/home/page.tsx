import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { loadProductStates } from '@/lib/engagement/repository'
import { countPreferences } from '@/lib/preferences/repository'
import { buildHomeFeed } from '@/lib/recommendations/service'
import { ButtonLink } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProductGrid } from '@/components/products/ProductGrid'

export const metadata = { title: 'Home' }

/**
 * The personalised feed.
 *
 * Sections come from the recommendation pipeline and are only rendered when
 * they have enough content to justify a heading — an "empty rail" is worse than
 * no rail. All rendering is server-side, so the page is useful on first paint
 * without waiting for client JavaScript.
 */
export default async function HomePage() {
  const session = await requireUser('/home')

  // A user who has never answered anything is sent through onboarding once.
  if (!session.profile.onboardingCompleted) redirect('/onboarding')

  const db = await getDb()
  const [sections, preferenceCount] = await Promise.all([
    buildHomeFeed(db, { userId: session.id }),
    countPreferences(db, session.id),
  ])

  await recordEvent(db, {
    userId: session.id,
    eventType: 'home_view',
    metadata: { sections: sections.length },
  })

  // One state lookup for every product on the page, rather than one per card.
  const productIds = [...new Set(sections.flatMap((s) => s.items.map((i) => i.product.id)))]
  const states = await loadProductStates(db, session.id, productIds)

  await recordEvent(db, {
    userId: session.id,
    eventType: 'recommendation_view',
    metadata: { products: productIds.length },
  })

  const firstName = session.profile.displayName.split(' ')[0]

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Hello, {firstName}</h1>
        <p className="text-ink-muted mt-1 text-sm">
          {preferenceCount === 0
            ? 'Save or like anything you find appealing and this feed will start to fit you.'
            : `Ranked against ${preferenceCount} preference${preferenceCount === 1 ? '' : 's'}. Adjust them any time.`}
        </p>
      </header>

      {sections.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          description="We could not find products matching what you have told us so far. Widening your preferences usually fixes this."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/preferences">Adjust preferences</ButtonLink>
              <ButtonLink href="/search" variant="secondary">
                Browse everything
              </ButtonLink>
            </div>
          }
        />
      ) : (
        sections.map((section) => (
          <section key={section.id} aria-labelledby={`section-${section.id}`}>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <div>
                <h2
                  id={`section-${section.id}`}
                  className="text-ink text-lg font-semibold tracking-tight"
                >
                  {section.title}
                </h2>
                {section.subtitle && (
                  <p className="text-ink-muted mt-0.5 text-sm">{section.subtitle}</p>
                )}
              </div>
            </div>

            <ProductGrid items={section.items} states={states} label={section.title} />
          </section>
        ))
      )}
    </div>
  )
}
