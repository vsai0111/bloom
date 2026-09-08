import { requireUser } from '@/lib/auth'
import { AppNavDesktop, AppNavMobile } from '@/components/layout/AppNav'
import { Logo } from '@/components/layout/Logo'
import { AnalyticsIdentity } from '@/components/shared/AnalyticsIdentity'

/**
 * Shell for every authenticated page.
 *
 * `requireUser()` here is the real access-control boundary. Middleware also
 * redirects unauthenticated visitors, but only to avoid a pointless render —
 * authorisation is never left to middleware alone, because a misconfigured
 * matcher would then silently expose every page beneath it.
 */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const session = await requireUser()

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <AnalyticsIdentity userId={session.id} />

      <header className="border-line bg-canvas/90 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Logo href="/home" />
          <AppNavDesktop />
        </div>
      </header>

      {/* pb-20 keeps content clear of the fixed mobile bottom bar. */}
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 pt-6 pb-20 md:pb-10">
        {children}
      </main>

      <AppNavMobile />
    </div>
  )
}
