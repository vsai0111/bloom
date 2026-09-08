'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { ensureProfile, getAuthProvider } from '@/lib/auth'
import { getDb } from '@/lib/db'
import type { Db } from '@/lib/db/types'
import type { AuthUser } from '@/types/user'
import { recordEvent } from '@/lib/analytics/events'
import { ensureSessionId } from '@/lib/analytics/session'
import { logger, reportError } from '@/lib/logging/logger'
import { safeInternalPath } from '@/lib/utils/url'

/**
 * Sign-up and sign-in.
 *
 * Both are `useActionState` form actions, so the pages work with JavaScript
 * disabled — a plain form POST still authenticates.
 *
 * The `next` parameter is passed through `safeInternalPath`, which rejects
 * anything that is not a same-origin absolute path. Without that, a crafted
 * `?next=https://evil.example` turns the sign-in page into an open redirect
 * that looks entirely legitimate to the user.
 */

export interface AuthFormState {
  error?: string
  /** Field the error belongs to, for aria-describedby wiring. */
  field?: 'email' | 'password'
  /**
   * Set when the account was created but the provider requires the address to
   * be verified before a session exists. The form renders confirmation
   * instructions instead of navigating, since there is nowhere to navigate to.
   */
  verificationEmail?: string
}

const credentials = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(200),
})

function readCredentials(formData: FormData) {
  return credentials.safeParse({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  })
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = readCredentials(formData)
  if (!parsed.success) {
    return { error: 'Enter an email address and a password.', field: 'email' }
  }

  const next = safeInternalPath(formData.get('next'), '/onboarding')

  try {
    const db = await getDb()
    const sessionId = await ensureSessionId()
    await recordEvent(db, { eventType: 'signup_started', sessionId })

    const result = await getAuthProvider().signUp(parsed.data)

    if (!result.ok) {
      return {
        error: result.message,
        field: result.code === 'weak_password' ? 'password' : 'email',
      }
    }

    // `user_events.user_id` references `profiles (id)`, so the profile has to
    // exist before the event can name the user. Provisioning is idempotent and
    // was previously deferred to the first authenticated page render, which is
    // after this point — so this event was failing its foreign key and being
    // dropped silently.
    if (await provisionProfile(db, result.user, 'signUp')) {
      await recordEvent(db, {
        userId: result.user.id,
        sessionId,
        eventType: 'signup_completed',
      })
    }

    // No session exists yet: the account is awaiting email verification. Tell
    // the user, rather than redirecting into a route that will bounce them to
    // sign-in where the only feedback is an authentication error.
    if (result.confirmationRequired) {
      return { verificationEmail: result.user.email }
    }

    redirect(next)
  } catch (error) {
    // `redirect()` throws a control-flow signal that must not be swallowed.
    if (isRedirectError(error)) throw error
    const reference = reportError(error, { operation: 'signUp' })
    return { error: `Could not create your account. Please try again. (ref ${reference})` }
  }
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = readCredentials(formData)
  if (!parsed.success) {
    return { error: 'Enter your email address and password.', field: 'email' }
  }

  const next = safeInternalPath(formData.get('next'), '/home')

  try {
    const result = await getAuthProvider().signIn(parsed.data)

    if (!result.ok) {
      // Deliberately the same message whether the email is unknown or the
      // password is wrong, so this page cannot be used to enumerate accounts.
      // An unconfirmed address is the exception: it is not an enumeration
      // signal (the person just submitted the signup form) and it is the one
      // case where the user can actually do something about it.
      return {
        error: result.message,
        field: result.code === 'email_not_confirmed' ? undefined : 'password',
      }
    }

    const db = await getDb()
    // Same ordering requirement as signup: first sign-in is the other moment a
    // user exists without a profile row yet.
    if (await provisionProfile(db, result.user, 'signIn')) {
      await recordEvent(db, {
        userId: result.user.id,
        sessionId: await ensureSessionId(),
        eventType: 'signin_completed',
      })
    }

    redirect(next)
  } catch (error) {
    if (isRedirectError(error)) throw error
    const reference = reportError(error, { operation: 'signIn' })
    return { error: `Could not sign you in. Please try again. (ref ${reference})` }
  }
}

export async function signOutAction(): Promise<void> {
  await getAuthProvider().signOut()
  redirect('/')
}

/**
 * Create the profile row that a funnel event points at, reporting whether it
 * exists afterwards.
 *
 * Failure is deliberately not fatal. Supabase answers a repeat signup for an
 * address it already knows with a synthetic user id it never stored in
 * `auth.users` — that is its defence against account enumeration — and
 * `profiles.id` references that table. Refusing the signup in that case would
 * both break a flow Supabase considers successful and leak the fact that the
 * address is taken. Losing one analytics row is the cheaper trade.
 */
async function provisionProfile(db: Db, user: AuthUser, operation: string): Promise<boolean> {
  try {
    await ensureProfile(db, user)
    return true
  } catch (error) {
    logger.warn('could not provision profile; funnel event skipped', { operation, error })
    return false
  }
}

/** Next.js signals navigation by throwing; those must propagate, not be logged. */
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  )
}
