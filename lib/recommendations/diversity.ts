import { DIVERSITY_LIMITS } from '@/config/scoring'
import type { RecommendedProduct } from '@/types/discovery'

/**
 * Diversity filtering.
 *
 * Pure ranking produces feeds that are technically optimal and useless to look
 * at: if a user likes olive boxy cotton, the top twenty results are twenty
 * near-identical olive tees from one brand. This re-orders a ranked list to
 * spread brands and subcategories out while preserving relative ranking as far
 * as the constraints allow.
 *
 * Deliberately a greedy pass rather than an optimisation problem — it is
 * predictable, fast, and easy to reason about when a feed looks wrong.
 */

export interface DiversityOptions {
  maxPerBrand?: number
  maxPerSubcategory?: number
  minBrandGap?: number
  limit?: number
}

export function diversify(
  ranked: readonly RecommendedProduct[],
  options: DiversityOptions = {},
): RecommendedProduct[] {
  const maxPerBrand = options.maxPerBrand ?? DIVERSITY_LIMITS.maxPerBrand
  const maxPerSubcategory = options.maxPerSubcategory ?? DIVERSITY_LIMITS.maxPerSubcategory
  const minBrandGap = options.minBrandGap ?? DIVERSITY_LIMITS.minBrandGap
  const limit = options.limit ?? ranked.length

  const selected: RecommendedProduct[] = []
  const deferred: RecommendedProduct[] = []
  const brandCounts = new Map<string, number>()
  const subcategoryCounts = new Map<string, number>()
  /** Position in `selected` where each brand last appeared. */
  const lastBrandIndex = new Map<string, number>()
  const seenProductIds = new Set<string>()

  const brandOf = (item: RecommendedProduct) => item.product.brand.toLowerCase()
  const subcategoryOf = (item: RecommendedProduct) =>
    `${item.product.category}:${item.product.subcategory ?? 'unknown'}`

  for (const item of ranked) {
    if (selected.length >= limit) break

    // The same canonical product must never appear twice in one feed.
    if (seenProductIds.has(item.product.id)) continue

    const brand = brandOf(item)
    const subcategory = subcategoryOf(item)

    const brandCount = brandCounts.get(brand) ?? 0
    const subcategoryCount = subcategoryCounts.get(subcategory) ?? 0
    const lastIndex = lastBrandIndex.get(brand)
    const tooSoon = lastIndex !== undefined && selected.length - lastIndex <= minBrandGap

    if (brandCount >= maxPerBrand || subcategoryCount >= maxPerSubcategory || tooSoon) {
      deferred.push(item)
      continue
    }

    seenProductIds.add(item.product.id)
    selected.push(item)
    brandCounts.set(brand, brandCount + 1)
    subcategoryCounts.set(subcategory, subcategoryCount + 1)
    lastBrandIndex.set(brand, selected.length - 1)
  }

  // Backfill from the deferred pile rather than returning a short feed. The
  // hard per-brand and per-subcategory caps still apply; only the spacing rule
  // is relaxed, because spacing is a presentation nicety and an empty row is not.
  for (const item of deferred) {
    if (selected.length >= limit) break
    if (seenProductIds.has(item.product.id)) continue

    const brand = brandOf(item)
    const subcategory = subcategoryOf(item)
    if ((brandCounts.get(brand) ?? 0) >= maxPerBrand) continue
    if ((subcategoryCounts.get(subcategory) ?? 0) >= maxPerSubcategory) continue

    seenProductIds.add(item.product.id)
    selected.push(item)
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1)
    subcategoryCounts.set(subcategory, (subcategoryCounts.get(subcategory) ?? 0) + 1)
  }

  return selected
}
