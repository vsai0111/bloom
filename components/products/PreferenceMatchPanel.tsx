import { RECOMMENDATION_WEIGHTS } from '@/config/scoring'
import type { RecommendationScore } from '@/types/discovery'
import { formatPercent, humanize } from '@/lib/utils/format'
import { ButtonLink } from '@/components/ui/Button'

/**
 * Why this product matched — the personalisation counterpart to the deal panel.
 *
 * Shows the actual preference rows that were and were not satisfied, so a user
 * can see the reasoning and correct it. That transparency is the point: a
 * recommendation you cannot interrogate is one you cannot fix.
 */
export function PreferenceMatchPanel({
  score,
  hasPreferences,
}: {
  score: RecommendationScore
  hasPreferences: boolean
}) {
  const matched = score.matchedPreferences.filter((m) => m.matched)
  const missed = score.matchedPreferences.filter((m) => !m.matched)

  return (
    <section
      aria-labelledby="match-heading"
      className="border-line bg-surface rounded-[var(--radius-card)] border p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="match-heading" className="text-ink text-base font-semibold">
          Why this is in your feed
        </h2>
        <span className="text-ink-muted text-sm">{formatPercent(score.total)} match</span>
      </div>

      {!hasPreferences ? (
        <div className="mt-4">
          <p className="text-ink-muted text-sm">
            You have not set any preferences yet, so this is ranked on deal quality and availability
            alone.
          </p>
          <ButtonLink href="/preferences" variant="secondary" size="sm" className="mt-3">
            Set your preferences
          </ButtonLink>
        </div>
      ) : (
        <>
          {matched.length > 0 && (
            <div className="mt-4">
              <h3 className="text-ink-subtle text-xs font-medium tracking-wide uppercase">
                Matches
              </h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {matched.map((match) => (
                  <li
                    key={`${match.attribute}-${match.value}`}
                    className="bg-accent-soft text-accent-strong rounded-full px-2.5 py-1 text-xs font-medium"
                  >
                    {humanize(match.value)}
                    <span className="sr-only"> matches your {match.attribute} preference</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {missed.length > 0 && (
            <div className="mt-4">
              <h3 className="text-ink-subtle text-xs font-medium tracking-wide uppercase">
                Does not match
              </h3>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {missed.slice(0, 8).map((match) => (
                  <li
                    key={`${match.attribute}-${match.value}`}
                    className="border-line text-ink-subtle rounded-full border px-2.5 py-1 text-xs"
                  >
                    {humanize(match.value)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {matched.length === 0 && missed.length === 0 && (
            <p className="text-ink-muted mt-4 text-sm">
              None of your preferences apply to this kind of product, so it is ranked on deal
              quality and availability.
            </p>
          )}
        </>
      )}

      {/* The component breakdown, for users who want the actual arithmetic. */}
      <details className="border-line mt-5 border-t pt-4">
        <summary className="text-ink-muted cursor-pointer text-xs underline underline-offset-2">
          How this score is calculated
        </summary>
        <dl className="mt-3 space-y-1.5">
          {Object.entries(score.components).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-4 text-xs">
              <dt className="text-ink-muted">
                {humanize(key.replace(/([A-Z])/g, ' $1').toLowerCase())}
                <span className="text-ink-subtle">
                  {' '}
                  (weight{' '}
                  {formatPercent(
                    RECOMMENDATION_WEIGHTS[key as keyof typeof RECOMMENDATION_WEIGHTS],
                  )}
                  )
                </span>
              </dt>
              <dd className="text-ink tabular-nums">{formatPercent(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}
