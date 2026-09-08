'use client'

import { useState, useTransition } from 'react'
import { addPreferenceAction, removePreferenceAction } from '@/app/(app)/actions'
import type { UserPreference } from '@/types/user'
import { humanize } from '@/lib/utils/format'
import { cn } from '@/lib/utils/cn'

/**
 * Preference editor.
 *
 * Everything Bloom believes about a user is listed here and can be removed in
 * one click, including preferences it inferred from behaviour. If the system
 * learns something wrong, the user must be able to see it and delete it —
 * otherwise a bad inference is permanent and invisible.
 */
export function PreferenceEditor({
  attribute,
  label,
  description,
  options,
  preferences,
  category,
}: {
  attribute: string
  label: string
  description?: string
  options: readonly string[]
  preferences: UserPreference[]
  category?: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const forAttribute = preferences.filter((preference) => preference.attribute === attribute)
  const selected = new Map(forAttribute.map((preference) => [preference.value, preference]))

  const toggle = (value: string) => {
    const existing = selected.get(value)
    setError(null)

    startTransition(async () => {
      const result = existing
        ? await removePreferenceAction(existing.id)
        : await addPreferenceAction({ attribute, value, category: category ?? null })

      if (!result.ok) setError(result.error)
    })
  }

  return (
    <section className="border-line bg-surface rounded-[var(--radius-card)] border p-5">
      <h2 className="text-ink text-sm font-semibold">{label}</h2>
      {description && <p className="text-ink-muted mt-1 text-xs">{description}</p>}

      <ul className="mt-4 flex flex-wrap gap-2">
        {options.map((value) => {
          const preference = selected.get(value)
          const active = Boolean(preference)

          return (
            <li key={value}>
              <button
                type="button"
                onClick={() => toggle(value)}
                disabled={pending}
                aria-pressed={active}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm transition-colors disabled:opacity-60',
                  active
                    ? 'border-accent bg-accent-soft text-accent-strong'
                    : 'border-line-strong bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {humanize(value)}
                {/* Surfaces that this one was learned rather than stated. */}
                {preference?.source === 'behavioral' && (
                  <span className="ml-1.5 text-xs opacity-70" title="Learned from your activity">
                    ·auto
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {error && (
        <p role="alert" className="text-negative mt-2 text-xs">
          {error}
        </p>
      )}
    </section>
  )
}
