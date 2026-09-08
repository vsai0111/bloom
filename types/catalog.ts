import type { Availability, Category, Gender } from '@/config/taxonomy'

/**
 * Domain types for the catalogue.
 *
 * These are the shapes the application reasons about. Database rows are
 * snake_case and are mapped into these camelCase types at the repository
 * boundary (lib/db/repositories/*), so nothing above that layer deals in column
 * names.
 */

export type Money = {
  /** Exact decimal amount. Parsed from Postgres `numeric`, never a float in the DB. */
  amount: number
  currency: string
}

export interface Merchant {
  id: string
  name: string
  slug: string
  websiteUrl: string
  logoUrl: string | null
  status: 'active' | 'paused' | 'disabled'
  allowedHosts: string[]
}

/** Normalised, merchant-independent descriptive attributes. */
export type ProductAttributes = {
  fit?: string
  style?: string
  material?: string
  color?: string
  [key: string]: string | undefined
}

export interface Product {
  id: string
  canonicalTitle: string
  description: string | null
  brand: string
  category: Category
  subcategory: string | null
  gender: Gender | null
  attributes: ProductAttributes
  matchKey: string
  createdAt: string
  updatedAt: string
}

export interface ProductVariant {
  id: string
  productId: string
  sku: string | null
  size: string | null
  color: string | null
  variantAttributes: Record<string, unknown>
}

export interface MerchantProductListing {
  id: string
  merchantId: string
  productId: string
  externalProductId: string
  title: string
  productUrl: string
  affiliateUrl: string | null
  imageUrl: string | null
  availability: Availability
  currentPrice: number
  originalPrice: number | null
  currency: string
  lastSyncedAt: string
}

export interface PricePoint {
  price: number
  originalPrice: number | null
  recordedAt: string
  source: string
}

/** A listing joined to the merchant selling it. */
export interface OfferSummary extends MerchantProductListing {
  merchantName: string
  merchantSlug: string
}
