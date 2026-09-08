'use client'

import { useEffect } from 'react'
import { Button, ButtonLink } from '@/components/ui/Button'

/**
 * Global error boundary.
 *
 * Shows a recoverable message and never the underlying error. Next.js already
 * strips server error details in production and replaces them with a `digest`;
 * that digest is displayed so a user can quote it in a support request and it
 * can be matched to the structured log line.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Client-side errors are not in the server log, so surface them here.
    console.error('Unhandled application error', { digest: error.digest })
  }, [error])

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col justify-center px-5 text-center">
      <h1 className="text-ink text-xl font-semibold">Something went wrong</h1>
      <p className="text-ink-muted mt-2 text-sm">
        This one is on us, not on you. Trying again often works.
      </p>

      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <ButtonLink href="/home" variant="secondary">
          Go to your feed
        </ButtonLink>
      </div>

      {error.digest && (
        <p className="text-ink-subtle mt-6 text-xs">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      )}
    </div>
  )
}
