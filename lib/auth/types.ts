import type { AuthUser } from '@/types/user'

/**
 * The authentication seam.
 *
 * Bloom targets Supabase Auth in production. No Supabase project has been
 * provisioned yet (see docs/development.md), so a local email/password provider
 * backed by the same database implements the identical interface, and the whole
 * product — signup, onboarding, personalisation, protected routes — is
 * exercisable today.
 *
 * Which provider is active is decided once, by configuration, in
 * lib/auth/provider.ts. Nothing above this interface knows or cares.
 */

export type AuthResult =
  | {
      ok: true
      user: AuthUser
      /**
       * The account exists but no session was established, because the provider
       * requires the email address to be confirmed first. The caller must not
       * treat this as "signed in" — there is nothing to sign in with yet.
       */
      confirmationRequired?: boolean
    }
  | { ok: false; code: AuthErrorCode; message: string }

export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_taken'
  | 'weak_password'
  | 'invalid_email'
  | 'email_not_confirmed'
  | 'not_authenticated'
  | 'rate_limited'
  | 'unavailable'

export interface AuthProvider {
  readonly id: 'supabase' | 'local'

  /** Create an account and start a session. */
  signUp(input: { email: string; password: string }): Promise<AuthResult>

  /** Verify credentials and start a session. */
  signIn(input: { email: string; password: string }): Promise<AuthResult>

  /** End the current session. */
  signOut(): Promise<void>

  /**
   * The user for the current request, or null.
   *
   * Must verify the session server-side on every call. It must never trust a
   * user id supplied by the client.
   */
  getUser(): Promise<AuthUser | null>
}
