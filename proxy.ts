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

/**
 * How close to expiry an access token must be before a refresh is worth a
 * network round trip. Supabase access tokens last an hour, so a five-minute
 * window still leaves the overwhelming majority of requests untouched.
 */
const REFRESH_WINDOW_SECONDS = 5 * 60

/**
 * Seconds remaining on the access token carried in these cookies, or null when
 * that cannot be determined.
 *
 * Null means "refresh": every failure path falls back to the unconditional
 * behaviour rather than risking a stale session, so an unfamiliar cookie format
 * costs performance and never correctness.
 *
 * This value is never treated as proof of anything. The cookie is supplied by
 * the client and its expiry is unverified — a forged one buys an attacker
 * nothing, because it only decides whether to spend a refresh. Authorisation
 * still happens in app/(app)/layout.tsx, which validates the token with
 * Supabase on every request.
 */
export function secondsUntilTokenExpiry(
  cookies: ReadonlyArray<{ name: string; value: string }>,
): number | null {
  const chunks = cookies
    .filter((cookie) => /^sb-.+-auth-token(\.\d+)?$/.test(cookie.name))
    // Chunk suffixes are .0, .1, ...; a session never approaches ten chunks.
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))

  if (chunks.length === 0) return null

  try {
    let encoded = chunks.map((cookie) => cookie.value).join('')
    if (encoded.startsWith('base64-')) encoded = encoded.slice('base64-'.length)

    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const session = JSON.parse(new TextDecoder().decode(bytes)) as { expires_at?: unknown }

    const expiresAt = Number(session.expires_at)
    if (!Number.isFinite(expiresAt)) return null

    return expiresAt - Math.floor(Date.now() / 1000)
  } catch {
    return null
  }
}

/** Whether this request should spend a round trip refreshing its session. */
function needsSessionRefresh(request: NextRequest): boolean {
  const remaining = secondsUntilTokenExpiry(request.cookies.getAll())
  return remaining === null || remaining <= REFRESH_WINDOW_SECONDS
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )

  /*
   * Refresh only when there is a session, and only when it is close to expiring.
   *
   * `refreshSupabaseSession` is a network call to the Supabase Auth API. Running
   * it unconditionally spent a cross-region round trip on every request — for
   * anonymous visitors, to discover there is no token at all, and for signed-in
   * ones, to renew a token with fifty-odd minutes left on it. Production traces
   * put that call at ~633ms of middleware time on requests that then went on to
   * validate the same token again while rendering.
   */
  const response =
    supabaseConfigured && hasSessionCookie(request) && needsSessionRefresh(request)
      ? await refreshSupabaseSession(request)
      : NextResponse.next()

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
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
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
