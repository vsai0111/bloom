import { redirect } from 'next/navigation'
import { APP_NAME, APP_TAGLINE } from '@/config/app'
import { getCurrentUser } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { ensureSessionId } from '@/lib/analytics/session'
import { ButtonLink } from '@/components/ui/Button'
import { Logo } from '@/components/layout/Logo'

export const metadata = { title: `${APP_NAME} — ${APP_TAGLINE}` }

/**
 * Landing page.
 *
 * Signed-in visitors go straight to their feed; there is no reason to make
 * someone read a pitch for a product they already use.
 */
export default async function LandingPage() {
  const user = await getCurrentUser()
  if (user) redirect('/home')

  // First funnel step. Recorded server-side so it does not depend on a
  // third-party script loading, or on the visitor allowing it to.
  const sessionId = await ensureSessionId()
  const db = await getDb()
  await recordEvent(db, { eventType: 'landing_view', sessionId })

  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav aria-label="Account" className="flex items-center gap-2">
          <ButtonLink href="/signin" variant="ghost" size="sm">
            Sign in
          </ButtonLink>
          <ButtonLink href="/signup" size="sm">
            Get started
          </ButtonLink>
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5">
        <section className="py-16 sm:py-24">
          <h1 className="text-ink max-w-3xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
            Find things you actually want, at a price that is actually good.
          </h1>
          <p className="text-ink-muted mt-5 max-w-xl text-lg leading-relaxed">
            {APP_NAME} learns what suits you, then tells you whether today&apos;s price is a genuine
            opportunity — using recorded price history, not marketing claims.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/signup" size="lg">
              Start with a few preferences
            </ButtonLink>
            <ButtonLink href="/signin" variant="secondary" size="lg">
              I already have an account
            </ButtonLink>
          </div>
        </section>

        <section aria-labelledby="how" className="border-line border-t py-14">
          <h2 id="how" className="text-ink-subtle text-sm font-medium tracking-wide uppercase">
            How it works
          </h2>
          <ul className="mt-6 grid gap-8 sm:grid-cols-3">
            {[
              {
                title: 'Tell us a little',
                body: 'A handful of questions — what you shop for, what you like. Skip anything you would rather not answer.',
              },
              {
                title: 'See why it matches',
                body: 'Every recommendation shows which of your preferences it meets. No black box, and nothing you cannot switch off.',
              },
              {
                title: 'Know if it is a good price',
                body: 'We compare against what the item has actually cost over time. When we do not have enough history, we say so rather than guessing.',
              },
            ].map((step) => (
              <li key={step.title}>
                <h3 className="text-ink font-medium">{step.title}</h3>
                <p className="text-ink-muted mt-2 text-sm leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="text-ink-subtle mx-auto w-full max-w-6xl px-5 py-8 text-xs">
        <p>
          {APP_NAME} links out to merchants and may earn a commission. It never changes the price
          you pay, and it never affects how products are ranked.
        </p>
      </footer>
    </>
  )
}
