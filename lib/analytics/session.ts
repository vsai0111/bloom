import 'server-only'
import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'

/**
 * Anonymous session id.
 *
 * Lets pre-signup funnel steps (landing_view, signup_started) be tied together
 * and then joined to the account once one exists — which is what makes the
 * signup conversion rate measurable at all.
 *
 * Deliberately not personal data: an opaque random id, no fingerprinting, and
 * it is not used for tracking across sites.
 */

export const SESSION_ID_COOKIE = 'bloom_sid'
const ONE_YEAR = 60 * 60 * 24 * 365

export async function getSessionId(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_ID_COOKIE)?.value ?? null
}

/**
 * Read the session id, creating one if absent.
 *
 * Only callable where cookies are writable (Server Actions and Route Handlers).
 * In a Server Component the write is silently skipped and a transient id is
 * returned.
 */
export async function ensureSessionId(): Promise<string> {
  const store = await cookies()
  const existing = store.get(SESSION_ID_COOKIE)?.value
  if (existing) return existing

  const id = randomUUID()
  try {
    store.set(SESSION_ID_COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: ONE_YEAR,
    })
  } catch {
    // Read-only cookie context (Server Component render). The id still lets
    // this request's events correlate with each other.
  }
  return id
}
