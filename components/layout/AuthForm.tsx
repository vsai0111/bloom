'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import type { AuthFormState } from '@/app/(auth)/actions'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { MIN_PASSWORD_LENGTH } from '@/config/auth'

/**
 * Shared sign-in / sign-up form.
 *
 * Uses `useActionState`, so the form posts and works without client JavaScript;
 * the pending state and inline errors are a progressive enhancement rather than
 * a requirement.
 */
export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: 'signin' | 'signup'
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>
  next?: string
}) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {})
  const isSignUp = mode === 'signup'

  // The account exists but is not usable yet. Re-rendering the form here would
  // invite the user to try signing in, which is exactly the dead end this
  // screen replaces.
  if (state.verificationEmail) {
    return (
      <div role="status" aria-live="polite">
        <h1 className="text-ink text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="text-ink-muted mt-2 text-sm">
          Your account is created. We sent a verification link to{' '}
          <span className="text-ink font-medium break-words">{state.verificationEmail}</span>.
        </p>

        <div className="border-line bg-accent-soft mt-7 rounded-[var(--radius-card)] border p-5">
          <p className="text-ink text-sm font-medium">Verify your email before signing in</p>
          <p className="text-ink-muted mt-1.5 text-sm">
            Sign-in will not work until you open that link. If it has not arrived within a couple of
            minutes, check your spam folder.
          </p>
        </div>

        <ButtonLink href="/signin" size="lg" className="mt-7 w-full">
          I have verified — sign in
        </ButtonLink>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-ink text-2xl font-semibold tracking-tight">
        {isSignUp ? 'Create your account' : 'Welcome back'}
      </h1>
      <p className="text-ink-muted mt-2 text-sm">
        {isSignUp
          ? 'Two fields, then a few quick questions so your feed is useful straight away.'
          : 'Sign in to pick up where you left off.'}
      </p>

      <form action={formAction} className="mt-7 space-y-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}

        <Field
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={state.field === 'email' ? state.error : undefined}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          required
          minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
          hint={isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}
          error={state.field === 'password' ? state.error : undefined}
        />

        {state.error && !state.field && (
          <p role="alert" className="text-negative text-sm">
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" loading={pending} className="w-full">
          {isSignUp ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="text-ink-muted mt-6 text-sm">
        {isSignUp ? 'Already have an account? ' : 'New to Bloom? '}
        <Link
          href={isSignUp ? '/signin' : '/signup'}
          className="text-accent-strong font-medium underline underline-offset-2"
        >
          {isSignUp ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </div>
  )
}
