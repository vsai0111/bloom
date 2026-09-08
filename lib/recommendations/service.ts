import 'server-only'
import { PAGE_SIZE, RECENTLY_VIEWED_LIMIT } from '@/config/app'
import { CATEGORY_LABELS, type Category } from '@/config/taxonomy'
import type { Db } from '@/lib/db/types'
import { str } from '@/lib/db/rows'
import { listActivePreferences } from '@/lib/preferences/repository'
import { loadCandidateProductIds, loadProductSummaries } from '@/lib/products/repository'
import type { FeedSection, ProductSummary, RecommendedProduct } from '@/types/discovery'
import type { UserPreference } from '@/types/user'
import { diversify } from './diversity'
import { explainRecommendation, scoreProduct } from './scoring'

/**
 * The recommendation pipeline.
 *
 *   candidates -> eligibility -> scoring -> ranking -> diversity -> feed
 *
 * Candidate generation is a SQL filter (in stock, active merchant, not
 * rejected); scoring and diversity happen in memory over a bounded candidate
 * set. At Phase 1 catalogue size this is the right trade: it keeps all ranking
 * logic in testable TypeScript instead of spread across SQL. The candidate cap
 * is the knob that keeps it honest as the catalogue grows — see
 * docs/recommendations.md.
 */

const CANDIDATE_LIMIT = 300

export interface FeedContext {
  userId: string
  now?: Date
}

/** Rank a set of already-loaded summaries against a user's preferences. */
export function rankSummaries(
  summaries: readonly ProductSummary[],
  preferences: readonly UserPreference[],
): RecommendedProduct[] {
  return summaries
    .map((summary) => {
      const score = scoreProduct(summary, preferences)
      return { ...summary, score, explanations: explainRecommendation(summary, score) }
    })
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total
      // Stable, meaningful tiebreak so equal scores do not order randomly.
      if (b.deal.score !== a.deal.score) return b.deal.score - a.deal.score
      return a.product.id.localeCompare(b.product.id)
    })
}

/** Products the user has explicitly rejected, plus anything already actioned. */
async function loadExcludedProductIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ product_id: string }>(
    `select product_id from product_rejections where user_id = $1`,
    [userId],
  )
  return rows.map((row) => str(row.product_id))
}

async function loadRecentlyViewedIds(db: Db, userId: string, limit: number): Promise<string[]> {
  const rows = await db.query<{ product_id: string }>(
    `select product_id, max(created_at) as last_seen
       from user_events
      where user_id = $1 and event_type = 'product_viewed' and product_id is not null
      group by product_id
      order by last_seen desc
      limit $2`,
    [userId, limit],
  )
  return rows.map((row) => str(row.product_id))
}

/**
 * Products with the most engagement recently, across all users.
 *
 * "Trending" is a genuine aggregate over recorded events. When there is not
 * enough activity to be meaningful the caller drops the section rather than
 * padding it out with arbitrary products.
 */
async function loadTrendingIds(db: Db, limit: number): Promise<string[]> {
  const rows = await db.query<{ product_id: string }>(
    `select product_id, count(*)::int as n
       from user_events
      where product_id is not null
        and event_type in ('product_viewed', 'product_liked', 'product_saved', 'merchant_clicked')
        and created_at > now() - interval '14 days'
      group by product_id
      having count(*) >= 3
      order by n desc
      limit $1`,
    [limit],
  )
  return rows.map((row) => str(row.product_id))
}

/**
 * Build the personalised home feed.
 *
 * Sections are only included when they have enough content to be worth a row —
 * an empty or near-empty "Because you like…" is worse than no section at all.
 */
export async function buildHomeFeed(db: Db, context: FeedContext): Promise<FeedSection[]> {
  const { userId, now } = context

  const [preferences, excluded, recentlyViewedIds] = await Promise.all([
    listActivePreferences(db, userId),
    loadExcludedProductIds(db, userId),
    loadRecentlyViewedIds(db, userId, RECENTLY_VIEWED_LIMIT),
  ])

  const preferredCategories = preferences
    .filter((p) => p.attribute === 'category')
    .map((p) => p.value)

  const candidateIds = await loadCandidateProductIds(db, {
    userId,
    excludeProductIds: excluded,
    // Candidates are drawn from the user's categories when they have stated
    // any, and from the whole catalogue otherwise.
    categories: preferredCategories.length > 0 ? preferredCategories : undefined,
    limit: CANDIDATE_LIMIT,
  })

  const summaries = await loadProductSummaries(db, candidateIds, { now })
  const ranked = rankSummaries(summaries, preferences)

  const sections: FeedSection[] = []
  const MIN_SECTION_SIZE = 4

  // --- For You -------------------------------------------------------------
  const forYou = diversify(ranked, { limit: PAGE_SIZE.feed })
  if (forYou.length >= MIN_SECTION_SIZE) {
    sections.push({
      id: 'for-you',
      title: 'For you',
      subtitle:
        preferences.length > 0
          ? 'Ranked against the preferences you have set'
          : 'Tell us what you like and this gets sharper',
      items: forYou,
    })
  }

  // --- Good deals ----------------------------------------------------------
  // Evidence-backed only: a high score with thin price history is not a claim
  // worth putting under a heading that says "good deals".
  const goodDeals = diversify(
    ranked.filter((item) => item.deal.score >= 75 && !item.deal.limitedEvidence),
    { limit: 12, maxPerBrand: 2 },
  )
  if (goodDeals.length >= MIN_SECTION_SIZE) {
    sections.push({
      id: 'good-deals',
      title: 'Good deals right now',
      subtitle: 'Priced below what these usually sell for',
      items: goodDeals,
    })
  }

  // --- Because you like … --------------------------------------------------
  const topPreference = preferences
    .filter((p) => ['color', 'style', 'fit', 'material', 'brand'].includes(p.attribute))
    .sort((a, b) => b.weight - a.weight)[0]

  if (topPreference) {
    const related = ranked.filter((item) =>
      item.score.matchedPreferences.some(
        (match) => match.matched && match.value === topPreference.value,
      ),
    )
    const items = diversify(related, { limit: 12, maxPerBrand: 3 })
    if (items.length >= MIN_SECTION_SIZE) {
      sections.push({
        id: `because-${topPreference.attribute}-${topPreference.value}`,
        title: `Because you like ${topPreference.value}`,
        items,
      })
    }
  }

  // --- Trending for you ----------------------------------------------------
  const trendingIds = await loadTrendingIds(db, 40)
  if (trendingIds.length >= MIN_SECTION_SIZE) {
    const trendingSummaries = await loadProductSummaries(
      db,
      trendingIds.filter((id) => !excluded.includes(id)),
      { now },
    )
    const items = diversify(rankSummaries(trendingSummaries, preferences), { limit: 12 })
    if (items.length >= MIN_SECTION_SIZE) {
      sections.push({
        id: 'trending',
        title: 'Trending for you',
        subtitle: 'Getting attention from other Bloom shoppers',
        items,
      })
    }
  }

  // --- Recently viewed -----------------------------------------------------
  if (recentlyViewedIds.length >= 2) {
    const recentSummaries = await loadProductSummaries(db, recentlyViewedIds, { now })
    const items = rankSummaries(recentSummaries, preferences)
    // Keep the user's own chronological order here, not our ranking.
    const byId = new Map(items.map((item) => [item.product.id, item]))
    const ordered = recentlyViewedIds
      .map((id) => byId.get(id))
      .filter((item): item is RecommendedProduct => item !== undefined)

    if (ordered.length >= 2) {
      sections.push({ id: 'recently-viewed', title: 'Recently viewed', items: ordered })
    }
  }

  return sections
}

/** Category rows used on the home page when a user has no preferences yet. */
export function categoryChips(): Array<{ id: Category; label: string }> {
  return (Object.keys(CATEGORY_LABELS) as Category[]).map((id) => ({
    id,
    label: CATEGORY_LABELS[id],
  }))
}
