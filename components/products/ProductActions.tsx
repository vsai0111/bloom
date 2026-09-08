'use client'

import { useState, useTransition } from 'react'
import { rejectProductAction, toggleLikeAction, toggleSaveAction } from '@/app/(app)/actions'
import type { ProductState } from '@/lib/engagement/repository'
import { cn } from '@/lib/utils/cn'

/**
 * Save / like / not-interested controls.
 *
 * Optimistic: the button flips immediately and reverts if the server rejects
 * the change, because waiting a round trip to see a heart fill in feels broken.
 * Errors surface as a small inline message rather than a thrown boundary — a
 * failed "like" should not blank the page the user is reading.
 */
export function ProductActions({
  productId,
  productTitle,
  initialState,
  onRejected,
  compact = false,
}: {
  productId: string
  productTitle: string
  initialState: ProductState
  /** Called after a successful rejection, so a feed can remove the card. */
  onRejected?: () => void
  compact?: boolean
}) {
  const [state, setState] = useState<ProductState>(initialState)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const run = (
    optimistic: Partial<ProductState>,
    action: () => Promise<{ ok: boolean; error?: string }>,
  ) => {
    const previous = state
    setState({ ...state, ...optimistic })
    setError(null)

    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setState(previous)
        setError(result.error ?? 'That did not work. Try again.')
      }
    })
  }

  const iconButton = (active: boolean) =>
    cn(
      'inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors',
      'disabled:opacity-50',
      active
        ? 'border-accent bg-accent-soft text-accent-strong'
        : 'border-line-strong bg-surface text-ink-muted hover:text-ink',
    )

  return (
    <div className={cn('flex flex-col gap-1', compact ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={iconButton(state.saved)}
          disabled={pending}
          aria-pressed={state.saved}
          aria-label={state.saved ? `Remove ${productTitle} from saved` : `Save ${productTitle}`}
          onClick={() => run({ saved: !state.saved }, () => toggleSaveAction(productId))}
        >
          <BookmarkIcon filled={state.saved} />
        </button>

        <button
          type="button"
          className={iconButton(state.liked)}
          disabled={pending}
          aria-pressed={state.liked}
          aria-label={state.liked ? `Unlike ${productTitle}` : `Like ${productTitle}`}
          onClick={() => run({ liked: !state.liked }, () => toggleLikeAction(productId))}
        >
          <HeartIcon filled={state.liked} />
        </button>

        <button
          type="button"
          className={iconButton(false)}
          disabled={pending || state.rejected}
          aria-label={`Not interested in ${productTitle}`}
          onClick={() =>
            run({ rejected: true }, async () => {
              const result = await rejectProductAction(productId)
              if (result.ok) onRejected?.()
              return result
            })
          }
        >
          <CrossIcon />
        </button>
      </div>

      {/* role="alert" is announced when inserted, so unlike a live region it
          does not need to sit empty in the DOM. That matters here: a feed
          renders dozens of these, and dozens of permanent live regions make a
          screen reader far noisier than it needs to be. */}
      {error && (
        <p role="alert" className="text-negative text-xs">
          {error}
        </p>
      )}
    </div>
  )
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4-7 4v-16a1 1 0 0 1 1-1Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" focusable="false">
      <path
        d="M12 20s-7-4.35-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5c0 5.15-7 9.5-7 9.5Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" focusable="false">
      <path
        d="M7 7l10 10M17 7L7 17"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
