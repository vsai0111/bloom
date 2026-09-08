import type { DealBandId } from '@/config/scoring'

/**
 * Deal intelligence types.
 *
 * Every number here is derived deterministically from recorded prices. Nothing
 * in this file is ever produced by a language model — see docs/deal-engine.md.
 */

/** Statistics computed from a listing's recorded price history. */
export interface PriceStatistics {
  currentPrice: number
  originalPrice: number | null
  currency: string

  /** Fraction off the original price, 0-1. Null when there is no trustworthy original. */
  discountFraction: number | null

  /** Mean observed price over the trailing window, or null when evidence is thin. */
  average30Day: number | null
  average90Day: number | null

  historicalLow: number | null
  historicalHigh: number | null

  /**
   * Where the current price sits within observed history, 0-1.
   * 0 means "at the lowest price ever seen", 1 means "at the highest".
   */
  pricePercentile: number | null

  /** Number of distinct price observations backing these figures. */
  observationCount: number

  /** Span of the price history in days. */
  historyDays: number
}

/** A single human-readable justification for a deal score. */
export interface DealReason {
  /** Stable identifier, so copy can change without breaking analytics. */
  code:
    | 'discount_vs_original'
    | 'below_recent_typical'
    | 'near_historical_low'
    | 'at_historical_low'
    | 'above_recent_typical'
    | 'no_discount'
    | 'insufficient_history'
  text: string
  /** Whether this reason argues for or against buying now. */
  sentiment: 'positive' | 'neutral' | 'negative'
}

export interface DealAssessment {
  /** 0-100. Higher means a better moment to buy. */
  score: number
  band: DealBandId
  bandLabel: string
  reasons: DealReason[]
  statistics: PriceStatistics
  /**
   * True when price history was too thin to judge properly. The UI must say so
   * rather than implying the score is well-evidenced.
   */
  limitedEvidence: boolean
}
