/**
 * Tunable weights and thresholds for the deal engine and recommendation engine.
 *
 * These are deliberately data, not logic. They are starting values chosen for
 * plausibility, NOT validated business truth — expect them to move once real
 * engagement data exists. Keeping them here means tuning never requires
 * touching scoring code, and every test can pin its own values.
 */

// ---------------------------------------------------------------------------
// Recommendation ranking
// ---------------------------------------------------------------------------

/** Component weights for the blended recommendation score. Must sum to 1. */
export const RECOMMENDATION_WEIGHTS = {
  preferenceMatch: 0.4,
  categoryRelevance: 0.2,
  priceFit: 0.15,
  brandAffinity: 0.1,
  dealQuality: 0.1,
  availability: 0.05,
} as const

export type RecommendationComponent = keyof typeof RECOMMENDATION_WEIGHTS

// ---------------------------------------------------------------------------
// Preference weighting
// ---------------------------------------------------------------------------

/**
 * How much a preference counts, by where it came from. Explicit statements
 * outrank weak behavioural inference, per the product brief.
 */
export const PREFERENCE_SOURCE_WEIGHTS = {
  explicit: 1.0,
  purchase: 0.9,
  behavioral: 0.5,
  inferred: 0.35,
} as const

export type PreferenceSource = keyof typeof PREFERENCE_SOURCE_WEIGHTS

/** Weight delta applied to a preference when a behavioural signal arrives. */
export const SIGNAL_WEIGHT_DELTAS = {
  product_like: 0.08,
  product_save: 0.12,
  merchant_click: 0.1,
  product_view: 0.015,
  search: 0.02,
  product_reject: -0.15,
} as const

export type LearningSignal = keyof typeof SIGNAL_WEIGHT_DELTAS

/** Preference weights are clamped to this range so no single signal can dominate. */
export const PREFERENCE_WEIGHT_BOUNDS = { min: 0.05, max: 1.0 } as const

/** A behaviourally-learned preference is only created once a signal repeats. */
export const BEHAVIORAL_PREFERENCE_THRESHOLD = 2

// ---------------------------------------------------------------------------
// Deal scoring
// ---------------------------------------------------------------------------

/**
 * Contribution of each evidence type to the 0-100 deal score. Components whose
 * evidence is missing are dropped and the remainder is renormalised, so a
 * product with no price history is scored on discount alone rather than being
 * silently penalised.
 */
export const DEAL_SCORE_WEIGHTS = {
  discountDepth: 0.4,
  vsRecentTypical: 0.35,
  nearHistoricalLow: 0.25,
} as const

/** Presentation bands for the deal score. Upper bound is inclusive. */
export const DEAL_SCORE_BANDS = [
  { id: 'poor', label: 'Poor', min: 0, max: 39 },
  { id: 'fair', label: 'Fair', min: 40, max: 59 },
  { id: 'good', label: 'Good', min: 60, max: 74 },
  { id: 'great', label: 'Great', min: 75, max: 89 },
  { id: 'excellent', label: 'Excellent', min: 90, max: 100 },
] as const

export type DealBandId = (typeof DEAL_SCORE_BANDS)[number]['id']

/**
 * A discount at or above this fraction saturates the discount component.
 * 60% off is treated as "as good as it realistically gets".
 */
export const DISCOUNT_SATURATION = 0.6

/** Minimum distinct price observations before averages are considered meaningful. */
export const MIN_OBSERVATIONS_FOR_AVERAGE = 3

/** Within this fraction above the historical low, a price counts as "near its low". */
export const NEAR_LOW_TOLERANCE = 0.05

// ---------------------------------------------------------------------------
// Diversity
// ---------------------------------------------------------------------------

/** Caps applied when assembling a feed so it does not collapse onto one brand. */
export const DIVERSITY_LIMITS = {
  maxPerBrand: 3,
  maxPerSubcategory: 4,
  /** Ranking positions a repeated brand must be separated by. */
  minBrandGap: 2,
} as const
