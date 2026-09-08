import { NextResponse, type NextRequest } from 'next/server'

/**
 * Proxy (formerly "middleware" — renamed in Next.js 16).
 *
 * Two jobs, and deliberately not a third:
 *
 *   1. Redirect obviously-unauthenticated visitors away from app pages, so they
 *      get the sign-in screen instead of a wasted render.
 *   2. Keep the Supabase Auth session cookie fresh, when Supabase is configured.
 *
 * What it does NOT do is authorise. It only checks that a session cookie is
 * *present*, never that it is valid — validation needs Node crypto and a
 * database lookup. Real authorisation happens in app/(app)/layout.tsx via
 * `requireUser()`. Treating middleware as the access-control boundary is how a
 * mistake in the `matcher` below silently exposes every page beneath it; here,
 * a broken matcher costs a redirect, not a data leak.
 */

const SESSION_COOKIES = ['bloom_session', 'sb-access-token']

/** Paths that require a session. Everything else is public. */
const PROTECTED_PREFIXES = [
  '/home',
  '/search',
  '/saved',
  '/preferences',
  '/profile',
  '/onboarding',
  '/product',
]

function hasSessionCookie(request: NextRequest): boolean {
  if (SESSION_COOKIES.some((name) => request.cookies.has(name))) return true
  // Supabase chunks its auth cookie and names it per project ref.
  return request.cookies.getAll().some((cookie) => /^sb-.*-auth-token/.test(cookie.name))
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )

  const response = supabaseConfigured ? await refreshSupabaseSession(request) : NextResponse.next()

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  if (isProtected && !hasSessionCookie(request)) {
    const signIn = new URL('/signin', request.url)
    // Preserve where they were going, as a path only — `safeInternalPath`
    // re-validates it before it is ever used as a redirect target.
    signIn.searchParams.set('next', pathname + request.nextUrl.search)
    return NextResponse.redirect(signIn)
  }

  return response
}

/**
 * Refresh the Supabase session so a expiring access token is renewed before the
 * page renders. No-op when Supabase is not configured.
 */
async function refreshSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request })

  try {
    const { createServerClient } = await import('@supabase/ssr')

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            response = NextResponse.next({ request })
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options)
            }
          },
        },
      },
    )

    await supabase.auth.getUser()
  } catch {
    // A failure to refresh must not block the request: the page will simply see
    // an unauthenticated user and redirect through the normal path.
  }

  return response
}

export const config = {
  /*
   * Everything except static assets, the image optimizer, and the merchant
   * click-out route (which handles its own anonymous case).
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/product-image|go/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
