import { MIN_OBSERVATIONS_FOR_AVERAGE } from '@/config/scoring'
import type { DealAssessment } from '@/types/deals'
import { formatMoney } from '@/lib/utils/format'
import { DealBadge } from './DealBadge'

/**
 * Why this product got the score it did.
 *
 * Every line is a computed statistic with its own reason code, not marketing
 * copy. Where the evidence is thin, the panel says so first — before any
 * positive reason — so a user is never persuaded by a number the data does not
 * support.
 */

const SENTIMENT_MARK: Record<string, { symbol: string; className: string; label: string }> = {
  positive: { symbol: '↓', className: 'text-positive', label: 'In your favour:' },
  negative: { symbol: '↑', className: 'text-negative', label: 'Against:' },
  neutral: { symbol: '•', className: 'text-ink-subtle', label: 'Note:' },
}

export function DealExplanation({ deal }: { deal: DealAssessment }) {
  const { statistics: stats } = deal

  return (
    <section
      aria-labelledby="deal-heading"
      className="border-line bg-surface rounded-[var(--radius-card)] border p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="deal-heading" className="text-ink text-base font-semibold">
          Price intelligence
        </h2>
        <DealBadge deal={deal} showScore={!deal.limitedEvidence} />
      </div>

      <ul className="mt-4 space-y-2">
        {deal.reasons.map((reason) => {
          const mark = SENTIMENT_MARK[reason.sentiment] ?? SENTIMENT_MARK.neutral
          return (
            <li key={reason.code} className="text-ink-muted flex gap-2.5 text-sm">
              <span aria-hidden="true" className={`mt-0.5 font-semibold ${mark.className}`}>
                {mark.symbol}
              </span>
              <span>
                <span className="sr-only">{mark.label} </span>
                {reason.text}
              </span>
            </li>
          )
        })}
      </ul>

      <dl className="border-line mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-sm sm:grid-cols-4">
        <Stat label="Current" value={formatMoney(stats.currentPrice, stats.currency)} emphasis />
        <Stat
          label="30-day typical"
          value={
            stats.average30Day === null ? null : formatMoney(stats.average30Day, stats.currency)
          }
        />
        <Stat
          label="90-day typical"
          value={
            stats.average90Day === null ? null : formatMoney(stats.average90Day, stats.currency)
          }
        />
        <Stat
          label="Lowest seen"
          value={
            stats.historicalLow === null ? null : formatMoney(stats.historicalLow, stats.currency)
          }
        />
      </dl>

      <p className="text-ink-subtle mt-4 text-xs">
        {stats.observationCount === 0
          ? 'We have not recorded any price changes for this listing yet.'
          : `Based on ${stats.observationCount} recorded price${stats.observationCount === 1 ? '' : 's'}` +
            (stats.historyDays > 0 ? ` over ${stats.historyDays} days.` : '.') +
            (stats.observationCount < MIN_OBSERVATIONS_FOR_AVERAGE
              ? ' That is too few to establish a typical price.'
              : '')}
      </p>
    </section>
  )
}

/**
 * A single statistic. A missing value renders as an explicit dash rather than
 * being hidden, so the user can see which facts we do not have.
 */
function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string | null
  emphasis?: boolean
}) {
  return (
    <div>
      <dt className="text-ink-subtle text-xs">{label}</dt>
      <dd
        className={
          value === null
            ? 'text-ink-subtle'
            : emphasis
              ? 'text-ink font-semibold'
              : 'text-ink font-medium'
        }
      >
        {value ?? <span title="Not enough data">—</span>}
      </dd>
    </div>
  )
}
