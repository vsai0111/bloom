import { describe, expect, it } from 'vitest'
import { secondsUntilTokenExpiry } from '@/proxy'

/**
 * Deciding whether a request should spend a round trip refreshing its session.
 *
 * The proxy used to refresh unconditionally, which cost a cross-region call to
 * the Supabase Auth API on every request — ~633ms of middleware time in
 * production traces — to renew tokens that mostly had the best part of an hour
 * left. This reads the expiry the cookie already carries.
 *
 * The contract that matters: anything unreadable must return null, which the
 * caller treats as "refresh". A parsing failure is then a performance
 * regression, never a broken session.
 */

const PROJECT_COOKIE = 'sb-ldsszneduuszdwrayvbw-auth-token'

/** Encode a session the way @supabase/ssr writes it into the cookie. */
function sessionCookie(session: Record<string, unknown>, name = PROJECT_COOKIE) {
  const json = JSON.stringify(session)
  const bytes = new TextEncoder().encode(json)
  const binary = String.fromCharCode(...bytes)
  return { name, value: 'base64-' + btoa(binary) }
}

const NOW = () => Math.floor(Date.now() / 1000)

describe('secondsUntilTokenExpiry', () => {
  it('reads the remaining lifetime of a fresh token', () => {
    const remaining = secondsUntilTokenExpiry([
      sessionCookie({ access_token: 'x', expires_at: NOW() + 3600 }),
    ])

    expect(remaining).not.toBeNull()
    expect(remaining!).toBeGreaterThan(3500)
    expect(remaining!).toBeLessThanOrEqual(3600)
  })

  it('reports a negative remaining lifetime for an expired token', () => {
    const remaining = secondsUntilTokenExpiry([
      sessionCookie({ access_token: 'x', expires_at: NOW() - 120 }),
    ])

    expect(remaining).not.toBeNull()
    expect(remaining!).toBeLessThan(0)
  })

  it('reassembles a chunked cookie in order', () => {
    const whole = sessionCookie({ access_token: 'x'.repeat(200), expires_at: NOW() + 1800 })
    const middle = Math.floor(whole.value.length / 2)

    const remaining = secondsUntilTokenExpiry([
      // Deliberately out of order: cookie order is not guaranteed.
      { name: `${PROJECT_COOKIE}.1`, value: whole.value.slice(middle) },
      { name: `${PROJECT_COOKIE}.0`, value: whole.value.slice(0, middle) },
    ])

    expect(remaining).not.toBeNull()
    expect(remaining!).toBeGreaterThan(1700)
  })

  it('survives a session containing non-ASCII characters', () => {
    // Naive atob() mangles UTF-8; a throw here would silently disable the
    // optimisation for every user whose profile contains an accent.
    const remaining = secondsUntilTokenExpiry([
      sessionCookie({ user: { name: 'Zoë Ramírez — 東京' }, expires_at: NOW() + 900 }),
    ])

    expect(remaining).not.toBeNull()
    expect(remaining!).toBeGreaterThan(800)
  })

  it('returns null when there is no Supabase auth cookie', () => {
    expect(secondsUntilTokenExpiry([])).toBeNull()
    expect(secondsUntilTokenExpiry([{ name: 'bloom_sid', value: 'abc' }])).toBeNull()
  })

  it('returns null rather than throwing on an unreadable cookie', () => {
    // Each of these must degrade to "refresh", not to an exception in
    // middleware, which would take down every request.
    expect(secondsUntilTokenExpiry([{ name: PROJECT_COOKIE, value: 'not-base64!!' }])).toBeNull()
    expect(secondsUntilTokenExpiry([{ name: PROJECT_COOKIE, value: 'base64-' }])).toBeNull()
    expect(secondsUntilTokenExpiry([sessionCookie({ access_token: 'x' })])).toBeNull()
    expect(secondsUntilTokenExpiry([sessionCookie({ expires_at: 'soon' })])).toBeNull()
  })

  it('ignores cookies belonging to other concerns', () => {
    const remaining = secondsUntilTokenExpiry([
      { name: 'bloom_sid', value: 'session-id' },
      { name: 'bloom_session', value: 'local-provider-token' },
      sessionCookie({ expires_at: NOW() + 2400 }),
    ])

    expect(remaining).not.toBeNull()
    expect(remaining!).toBeGreaterThan(2300)
  })
})
