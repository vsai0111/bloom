import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Supabase Auth with email confirmation switched on.
 *
 * Supabase answers a signup that needs verification with a *user but no
 * session*. Read as a plain success, that sends someone into a protected route
 * which bounces them to sign-in, where the only feedback is an authentication
 * error they have no way to interpret. These tests pin the two behaviours that
 * close that gap: reporting the pending confirmation, and naming it correctly
 * when they try to sign in early.
 */

const { auth } = vi.hoisted(() => ({
  auth: {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    getUser: vi.fn(),
  },
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth }),
}))

const { SupabaseAuthProvider } = await import('@/lib/auth/supabase-provider')

const CREDENTIALS = { email: 'new.person@example.com', password: 'correct-horse-battery' }
const USER = { id: '3f6b4f00-0000-4000-8000-000000000001', email: CREDENTIALS.email }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('signing up when email confirmation is required', () => {
  it('reports the account as created but awaiting confirmation', async () => {
    // Supabase's shape for "verification email sent": a user, and no session.
    auth.signUp.mockResolvedValue({ data: { user: USER, session: null }, error: null })

    const result = await new SupabaseAuthProvider().signUp(CREDENTIALS)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.confirmationRequired).toBe(true)
    expect(result.user.email).toBe(CREDENTIALS.email)
  })

  it('does not claim confirmation is pending when a session came back', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: USER, session: { access_token: 'token' } },
      error: null,
    })

    const result = await new SupabaseAuthProvider().signUp(CREDENTIALS)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.confirmationRequired).toBe(false)
  })

  it('surfaces a duplicate address as email_taken, not as a pending confirmation', async () => {
    auth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered', status: 422 },
    })

    const result = await new SupabaseAuthProvider().signUp(CREDENTIALS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('email_taken')
  })
})

describe('signing in before the address is verified', () => {
  it('says the email needs confirming rather than that it is invalid', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email not confirmed', status: 400 },
    })

    const result = await new SupabaseAuthProvider().signIn(CREDENTIALS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('email_not_confirmed')
    // The regression this replaces: "Enter a valid email address." for an
    // address that was perfectly valid and had just been used to sign up.
    expect(result.message).not.toMatch(/valid email/i)
    expect(result.message).toMatch(/confirm/i)
  })

  it('still reports wrong credentials as invalid_credentials', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials', status: 400 },
    })

    const result = await new SupabaseAuthProvider().signIn(CREDENTIALS)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('invalid_credentials')
  })

  it('succeeds once the address has been verified', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { user: USER, session: { access_token: 'token' } },
      error: null,
    })

    const result = await new SupabaseAuthProvider().signIn(CREDENTIALS)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.id).toBe(USER.id)
  })
})
