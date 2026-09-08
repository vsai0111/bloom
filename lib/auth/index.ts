import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { supabaseAuthConfigured } from '@/config/env.server'
import { getDb } from '@/lib/db'
import type { Profile, SessionUser } from '@/types/user'
import { LocalAuthProvider } from './local-provider'
import { SupabaseAuthProvider } from './supabase-provider'
import type { AuthProvider } from './types'

export type { AuthProvider, AuthResult, AuthErrorCode } from './types'

/**
 * Choose the auth provider once, from configuration.
 *
 * Supabase Auth whenever it is configured; the local provider otherwise, so a
 * fresh clone can run the whole product with no credentials.
 */
export function getAuthProvider(): AuthProvider {
  return supabaseAuthConfigured() ? new SupabaseAuthProvider() : new LocalAuthProvider()
}

/**
 * The authenticated user for this request, or null.
 *
 * Wrapped in React's `cache` so that a page rendering several Server Components
 * verifies the session once per request rather than once per component.
 */
export const getCurrentUser = cache(async () => {
  return getAuthProvider().getUser()
})

/**
 * The user together with their Bloom profile, creating the profile on first
 * sight.
 *
 * Profile creation is idempotent (`on conflict do nothing`) and lazy rather
 * than a database trigger, which keeps it working identically under both auth
 * providers.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const user = await getCurrentUser()
  if (!user) return null

  const db = await getDb()
  const rows = await db.query<{
    id: string
    display_name: string
    onboarding_completed: boolean
    created_at: string
  }>(
    `insert into profiles (id, display_name)
     values ($1, $2)
     on conflict (id) do update set id = profiles.id
     returning id, display_name, onboarding_completed, created_at`,
    [user.id, defaultDisplayName(user.email)],
  )

  const row = rows[0]
  const profile: Profile = {
    id: row.id,
    displayName: row.display_name,
    onboardingCompleted: row.onboarding_completed,
    createdAt: String(row.created_at),
  }

  return { ...user, profile }
})

/**
 * Require an authenticated user, redirecting to sign-in when there is none.
 *
 * Every page under app/(app) calls this. It is the authorisation boundary —
 * middleware only redirects for a better user experience and is not relied on
 * for access control.
 */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const session = await getSessionUser()
  if (!session) {
    const target = returnTo ? `/signin?next=${encodeURIComponent(returnTo)}` : '/signin'
    redirect(target)
  }
  return session
}

/** A friendly initial display name derived from the email local part. */
function defaultDisplayName(email: string): string {
  const local = email.split('@')[0] ?? 'there'
  const cleaned = local.replace(/[._-]+/g, ' ').trim()
  if (!cleaned) return 'there'
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .slice(0, 80)
}
