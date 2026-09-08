import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/config/env.public'
import { logger } from '@/lib/logging/logger'
import type { AuthProvider, AuthErrorCode, AuthResult } from './types'

/**
 * Supabase Auth provider — the production path.
 *
 * Uses `@supabase/ssr` so the session lives in HttpOnly cookies managed by
 * Supabase and is verified server-side on every request. The publishable key is
 * the only key used here; no elevated Supabase API key is used by
 * request-handling code, or configured at all.
 *
 * NOT YET EXERCISED AGAINST A REAL PROJECT: no Supabase credentials have been
 * provisioned (see docs/development.md, "What I need from you"). The code path
 * is complete and type-checked, but it has not been run against a live Supabase
 * instance, so treat first-run issues as expected rather than surprising.
 */
export class SupabaseAuthProvider implements AuthProvider {
  readonly id = 'supabase' as const

  private async client() {
    const cookieStore = await cookies()

    return createServerClient(publicEnv.supabaseUrl, publicEnv.supabasePublishableKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session instead; see middleware.ts.
          }
        },
      },
    })
  }

  private mapError(message: string, status?: number): { code: AuthErrorCode; message: string } {
    const text = message.toLowerCase()
    if (text.includes('already registered') || text.includes('already exists')) {
      return { code: 'email_taken', message: 'An account already exists for that email address.' }
    }
    // Must precede the generic `email` branch below, which would otherwise
    // report an unverified address as a malformed one.
    if (text.includes('not confirmed') || text.includes('email_not_confirmed')) {
      return {
        code: 'email_not_confirmed',
        message:
          'Confirm your email address before signing in. Check your inbox for the verification link.',
      }
    }
    if (text.includes('invalid login') || text.includes('invalid credentials')) {
      return {
        code: 'invalid_credentials',
        message: 'That email and password combination is not correct.',
      }
    }
    if (text.includes('password')) {
      return { code: 'weak_password', message: 'Choose a stronger password.' }
    }
    if (text.includes('email')) {
      return { code: 'invalid_email', message: 'Enter a valid email address.' }
    }
    if (status === 429) {
      return { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' }
    }
    return { code: 'unavailable', message: 'Sign-in is temporarily unavailable. Please try again.' }
  }

  async signUp({ email, password }: { email: string; password: string }): Promise<AuthResult> {
    const supabase = await this.client()
    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      logger.warn('supabase signup failed', { code: error.code, status: error.status })
      return { ok: false, ...this.mapError(error.message, error.status) }
    }
    if (!data.user) {
      return {
        ok: false,
        code: 'unavailable',
        message: 'Account created but no session was returned. Check your email to confirm.',
      }
    }

    // Supabase returns a user but no session when email confirmation is on. The
    // account is real and the verification mail has been sent; the caller must
    // say so rather than redirecting into a protected route that will bounce
    // straight back to sign-in with no explanation.
    return {
      ok: true,
      user: { id: data.user.id, email: data.user.email ?? email },
      confirmationRequired: !data.session,
    }
  }

  async signIn({ email, password }: { email: string; password: string }): Promise<AuthResult> {
    const supabase = await this.client()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error || !data.user) {
      logger.warn('supabase signin failed', { code: error?.code, status: error?.status })
      return { ok: false, ...this.mapError(error?.message ?? '', error?.status) }
    }

    return { ok: true, user: { id: data.user.id, email: data.user.email ?? email } }
  }

  async signOut(): Promise<void> {
    const supabase = await this.client()
    await supabase.auth.signOut()
  }

  async getUser() {
    const supabase = await this.client()
    // getUser() revalidates the JWT with Supabase rather than trusting the
    // cookie's contents, which is what makes this safe to authorise on.
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    return { id: data.user.id, email: data.user.email ?? '' }
  }
}
