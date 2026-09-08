'use client'

import { useState, useTransition } from 'react'
import { removePreferenceAction } from '@/app/(app)/actions'
import type { UserPreference } from '@/types/user'
import { humanize } from '@/lib/utils/format'

/**
 * Everything Bloom currently believes, in one auditable list.
 *
 * Includes weights and where each belief came from. This is the accountability
 * surface for personalisation: a user can see that "we think you like olive,
 * 0.62, learned from your activity" and delete it if that is wrong.
 */
export function LearnedPreferences({ preferences }: { preferences: UserPreference[] }) {
  const [removing, setRemoving] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (preferences.length === 0) {
    return (
      <section className="border-line bg-surface rounded-[var(--radius-card)] border p-5">
        <h2 className="text-ink text-sm font-semibold">Everything Bloom knows about you</h2>
        <p className="text-ink-muted mt-2 text-sm">
          Nothing yet. Pick a few options above, or just start saving and liking things.
        </p>
      </section>
    )
  }

  const sorted = [...preferences].sort((a, b) => b.weight - a.weight)

  const remove = (id: string) => {
    setRemoving(id)
    startTransition(async () => {
      await removePreferenceAction(id)
      setRemoving(null)
    })
  }

  return (
    <section className="border-line bg-surface rounded-[var(--radius-card)] border p-5">
      <h2 className="text-ink text-sm font-semibold">Everything Bloom knows about you</h2>
      <p className="text-ink-muted mt-1 text-xs">
        {preferences.length} preference{preferences.length === 1 ? '' : 's'}, strongest first.
        Weight is how much each one counts when ranking.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Your preferences, with weight and source</caption>
          <thead>
            <tr className="border-line text-ink-subtle border-b text-xs tracking-wide uppercase">
              <th scope="col" className="py-2 pr-4 font-medium">
                Preference
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Type
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Weight
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Source
              </th>
              <th scope="col" className="py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((preference) => (
              <tr key={preference.id} className="border-line border-b last:border-0">
                <td className="text-ink py-2.5 pr-4 font-medium">{humanize(preference.value)}</td>
                <td className="text-ink-muted py-2.5 pr-4">{humanize(preference.attribute)}</td>
                <td className="text-ink-muted py-2.5 pr-4 tabular-nums">
                  {preference.weight.toFixed(2)}
                </td>
                <td className="text-ink-muted py-2.5 pr-4">
                  {preference.source === 'explicit'
                    ? 'You set this'
                    : preference.source === 'behavioral'
                      ? `Learned (${preference.signalCount} signals)`
                      : humanize(preference.source)}
                </td>
                <td className="py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => remove(preference.id)}
                    disabled={pending && removing === preference.id}
                    className="text-negative text-xs font-medium underline underline-offset-2 disabled:opacity-50"
                  >
                    Remove
                    <span className="sr-only">
                      {' '}
                      the {preference.attribute} preference for {preference.value}
                    </span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
