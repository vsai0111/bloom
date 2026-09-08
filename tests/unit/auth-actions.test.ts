import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The sign-up / sign-in Server Actions.
 *
 * Two behaviours are pinned here. First, ordering: the profile must be
 * provisioned before an event names the user, because `user_events.user_id`
 * references `profiles (id)`. Second, that a signup awaiting email verification
 * ends on an explanation rather than a redirect into a route the user cannot
 * enter yet.
 */

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  provider: { signUp: vi.fn(), signIn: vi.fn() },
  ensureProfile: vi.fn(),
  recordEvent: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getAuthProvider: () => mocks.provider,
  ensureProfile: (...args: unknown[]) => {
    mocks.calls.push('ensureProfile')
    return mocks.ensureProfile(...args)
  },
}))

vi.mock('@/lib/db', () => ({ getDb: async () => ({ query: vi.fn() }) }))

vi.mock('@/lib/analytics/events', () => ({
  recordEvent: (_db: unknown, input: { eventType: string }) => {
    mocks.calls.push(`recordEvent:${input.eventType}`)
    return mocks.recordEvent(input)
  },
}))

vi.mock('@/lib/analytics/session', () => ({ ensureSessionId: async () => 'session-id' }))

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    mocks.calls.push(`redirect:${target}`)
    mocks.redirect(target)
    // Next signals navigation by throwing; the real action re-throws it.
    const error = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;' })
    throw error
  },
}))

const { signUpAction, signInAction } = await import('@/app/(auth)/actions')

const USER = { id: '3f6b4f00-0000-4000-8000-000000000001', email: 'new.person@example.com' }

function form(): FormData {
  const data = new FormData()
  data.set('email', USER.email)
  data.set('password', 'correct-horse-battery')
  return data
}

beforeEach(() => {
  mocks.calls.length = 0
  // resetAllMocks, not clearAllMocks: a rejection queued by one test would
  // otherwise persist as the implementation for every test after it.
  vi.resetAllMocks()
})

describe('signUpAction when the provider requires email verification', () => {
  beforeEach(() => {
    mocks.provider.signUp.mockResolvedValue({ ok: true, user: USER, confirmationRequired: true })
  })

  it('returns verification instructions instead of redirecting', async () => {
    const state = await signUpAction({}, form())

    expect(state.verificationEmail).toBe(USER.email)
    expect(state.error).toBeUndefined()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('still records signup_completed, and provisions the profile first', async () => {
    await signUpAction({}, form())

    expect(mocks.calls).toEqual([
      'recordEvent:signup_started',
      'ensureProfile',
      'recordEvent:signup_completed',
    ])
    expect(mocks.ensureProfile).toHaveBeenCalledWith(expect.anything(), USER)
  })
})

describe('signUpAction when the profile cannot be provisioned', () => {
  it('still reports the account as awaiting verification, and skips the event', async () => {
    // Supabase answers a repeat signup for a known address with a synthetic
    // user id that has no auth.users row, which profiles.id references.
    mocks.provider.signUp.mockResolvedValue({ ok: true, user: USER, confirmationRequired: true })
    mocks.ensureProfile.mockRejectedValue(new Error('profiles_id_fkey'))

    const state = await signUpAction({}, form())

    expect(state.error).toBeUndefined()
    expect(state.verificationEmail).toBe(USER.email)
    // Refusing the signup here would leak that the address is already taken.
    expect(mocks.calls).toEqual(['recordEvent:signup_started', 'ensureProfile'])
  })
})

describe('signUpAction when a session is established immediately', () => {
  it('provisions the profile, records the event, then redirects', async () => {
    mocks.provider.signUp.mockResolvedValue({ ok: true, user: USER, confirmationRequired: false })

    // A successful redirect propagates as a thrown NEXT_REDIRECT signal, which
    // is exactly what the confirmation path must avoid doing.
    await expect(signUpAction({}, form())).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.calls).toEqual([
      'recordEvent:signup_started',
      'ensureProfile',
      'recordEvent:signup_completed',
      'redirect:/onboarding',
    ])
  })
})

describe('signInAction', () => {
  it('provisions the profile before recording signin_completed', async () => {
    mocks.provider.signIn.mockResolvedValue({ ok: true, user: USER })

    await expect(signInAction({}, form())).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.calls).toEqual(['ensureProfile', 'recordEvent:signin_completed', 'redirect:/home'])
  })

  it('shows an unconfirmed-email error as a form-level message, not a password error', async () => {
    mocks.provider.signIn.mockResolvedValue({
      ok: false,
      code: 'email_not_confirmed',
      message: 'Confirm your email address before signing in.',
    })

    const state = await signInAction({}, form())

    // `field` unset routes it to the form-level alert rather than pinning it
    // under the password input, which would misdescribe the problem.
    expect(state.field).toBeUndefined()
    expect(state.error).toMatch(/confirm/i)
    expect(mocks.calls).toEqual([])
  })

  it('still attributes bad credentials to the password field', async () => {
    mocks.provider.signIn.mockResolvedValue({
      ok: false,
      code: 'invalid_credentials',
      message: 'That email and password combination is not correct.',
    })

    const state = await signInAction({}, form())

    expect(state.field).toBe('password')
  })
})
