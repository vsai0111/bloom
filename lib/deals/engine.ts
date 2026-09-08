import {
  DEAL_SCORE_BANDS,
  DEAL_SCORE_WEIGHTS,
  DISCOUNT_SATURATION,
  MIN_OBSERVATIONS_FOR_AVERAGE,
  NEAR_LOW_TOLERANCE,
  type DealBandId,
} from '@/config/scoring'
import type { PricePoint } from '@/types/catalog'
import type { DealAssessment, DealReason, PriceStatistics } from '@/types/deals'
import { clamp01, mean, round2, round4 } from '@/lib/utils/number'

/**
 * The deal engine.
 *
 * Deterministic and pure: the same inputs always produce the same score, and
 * every score is traceable to recorded prices. A language model is never
 * consulted here, directly or indirectly.
 *
 * The central design rule is that missing evidence is stated, not filled in. A
 * product with no price history does not get a made-up "typical price" — the
 * corresponding score component is dropped, the remaining weights are
 * renormalised, and `limitedEvidence` is set so the UI can say so plainly.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface DealInput {
  currentPrice: number
  originalPrice: number | null
  currency: string
  /** Recorded price observations for this listing. Order does not matter. */
  history: readonly PricePoint[]
  /** Injectable for deterministic tests. */
  now?: Date
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export function computePriceStatistics(input: DealInput): PriceStatistics {
  const now = input.now ?? new Date()
  const points = [...input.history]
    .map((point) => ({ price: Number(point.price), at: new Date(point.recordedAt).getTime() }))
    .filter((point) => Number.isFinite(point.price) && point.price > 0 && Number.isFinite(point.at))
    .sort((a, b) => a.at - b.at)

  const prices = points.map((p) => p.price)
  const discount =
    input.originalPrice !== null && input.originalPrice > input.currentPrice
      ? round4((input.originalPrice - input.currentPrice) / input.originalPrice)
      : null

  const windowAverage = (days: number): number | null => {
    const cutoff = now.getTime() - days * DAY_MS
    const windowPrices = points.filter((p) => p.at >= cutoff).map((p) => p.price)
    if (windowPrices.length < MIN_OBSERVATIONS_FOR_AVERAGE) return null
    const value = mean(windowPrices)
    return value === null ? null : round2(value)
  }

  const low = prices.length > 0 ? Math.min(...prices) : null
  const high = prices.length > 0 ? Math.max(...prices) : null

  // Where the current price sits between the lowest and highest observed price.
  let percentile: number | null = null
  if (low !== null && high !== null && high > low) {
    percentile = round4(clamp01((input.currentPrice - low) / (high - low)))
  } else if (low !== null && high !== null && high === low) {
    // Price has never moved: it is simultaneously the low and the high.
    percentile = 0
  }

  const historyDays =
    points.length >= 2 ? Math.round((points[points.length - 1].at - points[0].at) / DAY_MS) : 0

  return {
    currentPrice: round2(input.currentPrice),
    originalPrice: input.originalPrice === null ? null : round2(input.originalPrice),
    currency: input.currency,
    discountFraction: discount,
    average30Day: windowAverage(30),
    average90Day: windowAverage(90),
    historicalLow: low === null ? null : round2(low),
    historicalHigh: high === null ? null : round2(high),
    pricePercentile: percentile,
    observationCount: points.length,
    historyDays,
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type Component = { key: keyof typeof DEAL_SCORE_WEIGHTS; value: number }

/**
 * Score the components for which there is actual evidence.
 *
 * Each returned value is 0-1. Components with no evidence are simply absent.
 */
function scoreComponents(stats: PriceStatistics): Component[] {
  const components: Component[] = []

  // 1. Depth of discount against a trustworthy original price.
  if (stats.discountFraction !== null) {
    components.push({
      key: 'discountDepth',
      value: clamp01(stats.discountFraction / DISCOUNT_SATURATION),
    })
  }

  // 2. How the current price compares with what this listing recently cost.
  //    30-day window preferred; 90-day used when the shorter window is thin.
  const typical = stats.average30Day ?? stats.average90Day
  if (typical !== null && typical > 0) {
    const below = (typical - stats.currentPrice) / typical
    // A quarter below the recent typical price saturates this component; being
    // above it scores below the midpoint rather than zero.
    components.push({ key: 'vsRecentTypical', value: clamp01(0.5 + below / 0.5) })
  }

  // 3. Proximity to the lowest price ever recorded for this listing.
  if (
    stats.pricePercentile !== null &&
    stats.observationCount >= MIN_OBSERVATIONS_FOR_AVERAGE &&
    stats.historicalHigh !== null &&
    stats.historicalLow !== null &&
    stats.historicalHigh > stats.historicalLow
  ) {
    components.push({ key: 'nearHistoricalLow', value: clamp01(1 - stats.pricePercentile) })
  }

  return components
}

/** Weighted mean of the available components, renormalised over their weights. */
function blend(components: Component[]): number | null {
  if (components.length === 0) return null

  let weighted = 0
  let totalWeight = 0
  for (const component of components) {
    const weight = DEAL_SCORE_WEIGHTS[component.key]
    weighted += component.value * weight
    totalWeight += weight
  }

  return totalWeight === 0 ? null : weighted / totalWeight
}

export function bandFor(score: number): (typeof DEAL_SCORE_BANDS)[number] {
  return (
    DEAL_SCORE_BANDS.find((band) => score >= band.min && score <= band.max) ?? DEAL_SCORE_BANDS[0]
  )
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

function percent(fraction: number): number {
  return Math.round(fraction * 100)
}

/**
 * Build the user-facing justification.
 *
 * Every sentence is tied to a specific computed statistic; there is no generic
 * persuasive copy. Where evidence is missing, that absence is itself stated.
 */
function buildReasons(stats: PriceStatistics): DealReason[] {
  const reasons: DealReason[] = []

  if (stats.discountFraction !== null && stats.originalPrice !== null) {
    reasons.push({
      code: 'discount_vs_original',
      text: `${percent(stats.discountFraction)}% below its original price of ${formatBare(stats.originalPrice)}`,
      sentiment: 'positive',
    })
  }

  const typical = stats.average30Day ?? stats.average90Day
  const windowLabel = stats.average30Day !== null ? '30-day' : '90-day'
  if (typical !== null && typical > 0) {
    const delta = (typical - stats.currentPrice) / typical
    if (delta >= 0.02) {
      reasons.push({
        code: 'below_recent_typical',
        text: `${percent(delta)}% below its ${windowLabel} typical price of ${formatBare(typical)}`,
        sentiment: 'positive',
      })
    } else if (delta <= -0.02) {
      reasons.push({
        code: 'above_recent_typical',
        text: `${percent(Math.abs(delta))}% above its ${windowLabel} typical price`,
        sentiment: 'negative',
      })
    }
  }

  if (stats.historicalLow !== null && stats.observationCount >= MIN_OBSERVATIONS_FOR_AVERAGE) {
    if (stats.currentPrice <= stats.historicalLow) {
      reasons.push({
        code: 'at_historical_low',
        text: 'This is the lowest price we have recorded for it',
        sentiment: 'positive',
      })
    } else if (stats.currentPrice <= stats.historicalLow * (1 + NEAR_LOW_TOLERANCE)) {
      reasons.push({
        code: 'near_historical_low',
        text: `Within ${percent(NEAR_LOW_TOLERANCE)}% of its lowest recorded price`,
        sentiment: 'positive',
      })
    }
  }

  if (stats.observationCount < MIN_OBSERVATIONS_FOR_AVERAGE) {
    reasons.push({
      code: 'insufficient_history',
      text:
        stats.observationCount === 0
          ? 'We have not tracked this price long enough to judge the deal'
          : `Only ${stats.observationCount} price observation${stats.observationCount === 1 ? '' : 's'} so far, so this is a provisional read`,
      sentiment: 'neutral',
    })
  }

  if (reasons.length === 0) {
    reasons.push({
      code: 'no_discount',
      text: 'Selling at its usual price',
      sentiment: 'neutral',
    })
  }

  return reasons
}

/** Plain number formatting for reason strings; the UI adds the currency symbol. */
function formatBare(value: number): string {
  return value.toFixed(2).replace(/\.00$/, '')
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Neutral score used when there is no evidence at all to judge a price. */
export const NEUTRAL_SCORE = 50

export function assessDeal(input: DealInput): DealAssessment {
  const statistics = computePriceStatistics(input)
  const components = scoreComponents(statistics)
  const blended = blend(components)

  // No evidence: return a neutral score rather than a low one. Scoring an
  // unknown price as "Poor" would be a claim we cannot support, and scoring it
  // "Excellent" would be worse. `limitedEvidence` tells the UI to show the
  // absence of data instead of the band.
  const score = blended === null ? NEUTRAL_SCORE : Math.round(clamp01(blended) * 100)
  const band = bandFor(score)

  return {
    score,
    band: band.id as DealBandId,
    bandLabel: band.label,
    reasons: buildReasons(statistics),
    statistics,
    limitedEvidence: blended === null || statistics.observationCount < MIN_OBSERVATIONS_FOR_AVERAGE,
  }
}
