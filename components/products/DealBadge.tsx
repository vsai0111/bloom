import type { DealBandId } from '@/config/scoring'
import type { DealAssessment } from '@/types/deals'
import { cn } from '@/lib/utils/cn'

/**
 * The deal score, shown honestly.
 *
 * The rule this component exists to enforce: when `limitedEvidence` is set,
 * Bloom does NOT show a band. A confident "Great deal" derived from two price
 * observations is exactly the kind of claim the product brief rules out, so the
 * badge degrades to a plain statement that the price is not yet well understood.
 */

const BAND_STYLES: Record<DealBandId, string> = {
  excellent: 'text-deal-excellent border-deal-excellent/30 bg-deal-excellent/8',
  great: 'text-deal-great border-deal-great/30 bg-deal-great/8',
  good: 'text-deal-good border-deal-good/30 bg-deal-good/8',
  fair: 'text-deal-fair border-deal-fair/30 bg-deal-fair/8',
  poor: 'text-deal-poor border-deal-poor/30 bg-deal-poor/8',
}

export function DealBadge({
  deal,
  showScore = false,
  className,
}: {
  deal: DealAssessment
  showScore?: boolean
  className?: string
}) {
  if (deal.limitedEvidence) {
    return (
      <span
        className={cn(
          'border-line bg-surface-sunken text-ink-subtle inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
          className,
        )}
      >
        Not enough price history
      </span>
    )
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
        BAND_STYLES[deal.band],
        className,
      )}
    >
      {deal.bandLabel} deal
      {showScore && <span className="font-normal opacity-70">{deal.score}/100</span>}
    </span>
  )
}
