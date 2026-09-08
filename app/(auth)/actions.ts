'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getAuthProvider } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { recordEvent } from '@/lib/analytics/events'
import { ensureSessionId } from '@/lib/analytics/session'
import { reportError } from '@/lib/logging/logger'
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

    await recordEvent(db, {
      userId: result.user.id,
      sessionId,
      eventType: 'signup_completed',
    })

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
      return { error: result.message, field: 'password' }
    }

    const db = await getDb()
    await recordEvent(db, {
      userId: result.user.id,
      sessionId: await ensureSessionId(),
      eventType: 'signin_completed',
    })

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
