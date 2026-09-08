import { RECOMMENDATION_WEIGHTS, type RecommendationComponent } from '@/config/scoring'
import { priceBandFor } from '@/config/taxonomy'
import { clamp01, round4 } from '@/lib/utils/number'
import type { ProductSummary, PreferenceMatch, RecommendationScore } from '@/types/discovery'
import type { UserPreference } from '@/types/user'

/**
 * Recommendation scoring.
 *
 * Pure functions over a product and a user's preferences. Every component is
 * computed independently and returned alongside the blended total, so that:
 *   - the UI can explain *why* something was recommended,
 *   - weights in config/scoring.ts can be retuned without touching logic,
 *   - each component can be unit-tested in isolation.
 *
 * Deterministic by design. Given the same product and preferences the score is
 * always identical, which is what makes ranking regressions detectable.
 */

/** Attributes matched against `product.attributes`. */
const PRODUCT_ATTRIBUTE_KEYS = new Set(['color', 'fit', 'style', 'material'])

/** Case-insensitive comparison; preference values are stored lower-cased. */
function sameValue(a: string | null | undefined, b: string): boolean {
  return typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The product's value for a preference attribute, or null if it has none. */
function productValueFor(summary: ProductSummary, attribute: string): string | null {
  const { product, offer } = summary

  switch (attribute) {
    case 'brand':
      return product.brand
    case 'category':
      return product.category
    case 'subcategory':
      return product.subcategory
    case 'price_band':
      return priceBandFor(offer.currentPrice)
    default:
      if (PRODUCT_ATTRIBUTE_KEYS.has(attribute)) {
        return product.attributes[attribute] ?? null
      }
      return null
  }
}

/**
 * Does this preference apply to this product at all?
 *
 * A preference scoped to `clothing` should not drag down a pair of headphones.
 */
function preferenceApplies(summary: ProductSummary, preference: UserPreference): boolean {
  if (preference.category && preference.category !== summary.product.category) return false
  return productValueFor(summary, preference.attribute) !== null
}

interface GroupOutcome {
  /** Weight of the best matching preference in this group. */
  matched: number
  /** Weight of the strongest preference in this group. */
  best: number
  matches: PreferenceMatch[]
}

/**
 * Score one attribute group (all the user's colour preferences, say).
 *
 * Grouping matters: a user who likes olive, navy and black should not be
 * penalised for a product being only one of those. The group scores on its best
 * match relative to its strongest preference.
 */
function scoreGroup(summary: ProductSummary, preferences: UserPreference[]): GroupOutcome {
  const outcome: GroupOutcome = { matched: 0, best: 0, matches: [] }

  for (const preference of preferences) {
    if (!preferenceApplies(summary, preference)) continue

    const productValue = productValueFor(summary, preference.attribute)
    const matched = sameValue(productValue, preference.value)

    outcome.best = Math.max(outcome.best, preference.weight)
    if (matched) outcome.matched = Math.max(outcome.matched, preference.weight)

    outcome.matches.push({
      attribute: preference.attribute,
      value: preference.value,
      weight: preference.weight,
      matched,
    })
  }

  return outcome
}

function groupBy(preferences: readonly UserPreference[]): Map<string, UserPreference[]> {
  const groups = new Map<string, UserPreference[]>()
  for (const preference of preferences) {
    const group = groups.get(preference.attribute) ?? []
    group.push(preference)
    groups.set(preference.attribute, group)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Descriptive-attribute fit: colour, fit, style, material, subcategory, brand. */
export function preferenceMatchScore(
  summary: ProductSummary,
  preferences: readonly UserPreference[],
): { score: number; matches: PreferenceMatch[] } {
  const groups = groupBy(
    preferences.filter((p) => p.attribute !== 'category' && p.attribute !== 'price_band'),
  )

  let matched = 0
  let best = 0
  const matches: PreferenceMatch[] = []

  for (const group of groups.values()) {
    const outcome = scoreGroup(summary, group)
    matched += outcome.matched
    best += outcome.best
    matches.push(...outcome.matches)
  }

  // With nothing to compare against, return the neutral midpoint rather than 0.
  // A new user has no preferences, and scoring every product 0 would make the
  // component meaningless instead of merely uninformative.
  const score = best === 0 ? 0.5 : clamp01(matched / best)
  return { score: round4(score), matches }
}

/** Is this the kind of thing the user said they shop for? */
export function categoryRelevanceScore(
  summary: ProductSummary,
  preferences: readonly UserPreference[],
): number {
  const categoryPreferences = preferences.filter((p) => p.attribute === 'category')
  if (categoryPreferences.length === 0) return 0.5

  const best = Math.max(...categoryPreferences.map((p) => p.weight))
  const match = categoryPreferences.find((p) => sameValue(summary.product.category, p.value))

  // Not zero for a non-matching category: the user may well want an adjacent
  // category surfaced occasionally, and a hard zero makes discovery impossible.
  return match ? round4(clamp01(match.weight / best)) : 0.15
}

/** Does the price sit in the band the user shops in? */
export function priceFitScore(
  summary: ProductSummary,
  preferences: readonly UserPreference[],
): number {
  const bandPreferences = preferences.filter((p) => p.attribute === 'price_band')
  if (bandPreferences.length === 0) return 0.5

  const band = priceBandFor(summary.offer.currentPrice)
  const exact = bandPreferences.find((p) => sameValue(band, p.value))
  if (exact) return 1

  // Cheaper than the user's usual band is mildly good; more expensive is not.
  const order = ['budget', 'mid', 'premium', 'luxury']
  const productIndex = order.indexOf(band)
  const preferredIndexes = bandPreferences.map((p) => order.indexOf(p.value)).filter((i) => i >= 0)
  if (preferredIndexes.length === 0 || productIndex < 0) return 0.5

  const distance = Math.min(...preferredIndexes.map((i) => Math.abs(i - productIndex)))
  const cheaper = productIndex < Math.min(...preferredIndexes)

  if (distance === 1) return cheaper ? 0.7 : 0.45
  return cheaper ? 0.5 : 0.2
}

/** Preference for this specific brand. */
export function brandAffinityScore(
  summary: ProductSummary,
  preferences: readonly UserPreference[],
): number {
  const brandPreferences = preferences.filter((p) => p.attribute === 'brand')
  if (brandPreferences.length === 0) return 0.5

  const best = Math.max(...brandPreferences.map((p) => p.weight))
  const match = brandPreferences.find((p) => sameValue(summary.product.brand, p.value))

  // An unfamiliar brand is not a negative — it is how a user discovers new ones.
  return match ? round4(clamp01(match.weight / best)) : 0.4
}

/** How good the current price is, from the deal engine. */
export function dealQualityScore(summary: ProductSummary): number {
  return round4(clamp01(summary.deal.score / 100))
}

export function availabilityScore(summary: ProductSummary): number {
  switch (summary.offer.availability) {
    case 'in_stock':
      return 1
    case 'low_stock':
      return 0.8
    default:
      return 0
  }
}

// ---------------------------------------------------------------------------
// Blend
// ---------------------------------------------------------------------------

export function scoreProduct(
  summary: ProductSummary,
  preferences: readonly UserPreference[],
): RecommendationScore {
  const { score: preferenceMatch, matches } = preferenceMatchScore(summary, preferences)

  const components: Record<RecommendationComponent, number> = {
    preferenceMatch,
    categoryRelevance: categoryRelevanceScore(summary, preferences),
    priceFit: priceFitScore(summary, preferences),
    brandAffinity: brandAffinityScore(summary, preferences),
    dealQuality: dealQualityScore(summary),
    availability: availabilityScore(summary),
  }

  let total = 0
  for (const [key, weight] of Object.entries(RECOMMENDATION_WEIGHTS)) {
    total += components[key as RecommendationComponent] * weight
  }

  return {
    total: round4(clamp01(total)),
    components,
    matchedPreferences: matches,
  }
}

/**
 * Short, honest reasons for showing a product.
 *
 * Each string is derived from a computed fact. Nothing here is generated by a
 * model, and nothing claims more than the data supports.
 */
export function explainRecommendation(
  summary: ProductSummary,
  score: RecommendationScore,
): string[] {
  const explanations: string[] = []

  const matched = score.matchedPreferences.filter((m) => m.matched)
  if (matched.length > 0) {
    const highlights = matched
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((m) => m.value)

    explanations.push(
      matched.length === 1
        ? `Matches your preference for ${highlights[0]}`
        : `Matches ${matched.length} of your preferences: ${highlights.join(', ')}`,
    )
  }

  // Only claim a deal when the evidence is there to back it.
  if (!summary.deal.limitedEvidence && summary.deal.score >= 75) {
    const positive = summary.deal.reasons.find((r) => r.sentiment === 'positive')
    if (positive) explanations.push(positive.text)
  }

  if (summary.offer.availability === 'low_stock') {
    explanations.push('Low stock at this merchant')
  }

  if (summary.offerCount > 1) {
    explanations.push(`Compared across ${summary.offerCount} merchants`)
  }

  return explanations
}
