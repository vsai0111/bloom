import type { RecommendationComponent } from '@/config/scoring'
import type { Availability, Category } from '@/config/taxonomy'
import type { DealAssessment } from './deals'
import type { OfferSummary, Product } from './catalog'

/**
 * The shapes the discovery surfaces (home feed, search, product page) render.
 */

/** A product plus the single offer Bloom would send the user to. */
export interface ProductSummary {
  product: Product
  /** Best available offer: cheapest in-stock listing, tie-broken by merchant name. */
  offer: OfferSummary
  /** How many merchants list this product, so the UI can say "3 merchants". */
  offerCount: number
  deal: DealAssessment
  imageUrl: string | null
}

/** One preference that a product did or did not satisfy. */
export interface PreferenceMatch {
  attribute: string
  value: string
  /** The user's weight for this preference, 0-1. */
  weight: number
  matched: boolean
}

export interface RecommendationScore {
  /** Blended 0-1 score used for ranking. */
  total: number
  /** Per-component 0-1 scores, before weighting. Kept for explanation and tuning. */
  components: Record<RecommendationComponent, number>
  matchedPreferences: PreferenceMatch[]
}

/** A scored, explained product ready to render in a personalised feed. */
export interface RecommendedProduct extends ProductSummary {
  score: RecommendationScore
  /** Short user-facing reasons, e.g. "Matches 3 of your preferences". */
  explanations: string[]
}

/** A titled row on the home page. */
export interface FeedSection {
  id: string
  title: string
  subtitle?: string
  items: RecommendedProduct[]
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchFilters {
  category?: Category
  subcategory?: string
  brands?: string[]
  colors?: string[]
  sizes?: string[]
  fits?: string[]
  minPrice?: number
  maxPrice?: number
  /** Minimum discount as a percentage, 0-100. */
  minDiscount?: number
  availability?: Availability[]
}

export type SearchSort =
  'relevance' | 'price_asc' | 'price_desc' | 'discount' | 'deal_score' | 'newest'

export interface SearchQuery {
  text?: string
  filters?: SearchFilters
  sort?: SearchSort
  page?: number
  pageSize?: number
}

export interface SearchFacetValue {
  value: string
  label: string
  count: number
}

export interface SearchResult {
  items: ProductSummary[]
  total: number
  page: number
  pageSize: number
  facets: {
    categories: SearchFacetValue[]
    brands: SearchFacetValue[]
    colors: SearchFacetValue[]
  }
  /** Price bounds across the unfiltered result set, for the range control. */
  priceBounds: { min: number; max: number } | null
}
