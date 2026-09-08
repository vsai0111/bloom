import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { serverEnv } from '@/config/env.server'

/**
 * Signed session cookies for the local auth provider.
 *
 * The cookie carries a user id and an expiry, authenticated with an HMAC over
 * both. It is a bearer token, so it is HttpOnly (JavaScript cannot read it),
 * SameSite=Lax (not sent on cross-site POSTs, which is the CSRF control for
 * Server Actions) and Secure outside development.
 *
 * There is deliberately no server-side session table in Phase 1: statelessness
 * keeps it simple, and the 30-day expiry bounds the damage from a leaked
 * cookie. Revocation would need that table — noted in docs/decisions.md.
 */

export const SESSION_COOKIE = 'bloom_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

interface SessionPayload {
  /** Subject: the user id. */
  sub: string
  /** Expiry, seconds since epoch. */
  exp: number
}

function secret(): string {
  const configured = serverEnv().BLOOM_AUTH_SECRET
  if (configured && configured.length >= 16) return configured

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'BLOOM_AUTH_SECRET must be set (32+ random bytes) when using the local auth provider in production.',
    )
  }

  // Development convenience only: a per-process key. Restarting the dev server
  // invalidates sessions, which is a fair trade for not requiring setup.
  globalThis.__bloomDevAuthSecret ??= randomBytes(32).toString('hex')
  return globalThis.__bloomDevAuthSecret
}

declare global {
  var __bloomDevAuthSecret: string | undefined
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

export function createSessionToken(userId: string, ttlSeconds = SESSION_TTL_SECONDS): string {
  const payload: SessionPayload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const body = base64url(JSON.stringify(payload))
  return `${body}.${sign(body)}`
}

/**
 * Verify a token and return the user id, or null.
 *
 * Signature is checked before the payload is trusted, and compared in constant
 * time. Any malformed input returns null rather than throwing.
 */
export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null

  const separator = token.lastIndexOf('.')
  if (separator <= 0) return null

  const body = token.slice(0, separator)
  const signature = token.slice(separator + 1)

  const expected = Buffer.from(sign(body))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < Date.now()) return null
    return payload.sub
  } catch {
    return null
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}

export async function readSessionUserId(): Promise<string | null> {
  const store = await cookies()
  return readSessionToken(store.get(SESSION_COOKIE)?.value)
}
