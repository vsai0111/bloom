/**
 * The merchant data seam.
 *
 * Bloom must never be architected around one retailer. Every source of product
 * data — an affiliate network feed, a partner API, a CSV drop, or the local seed
 * catalogue — is expressed as a `MerchantProvider`, and the ingestion pipeline
 * knows nothing else about where products came from.
 *
 * Providers return RAW data. They do not normalise, do not decide product
 * identity, and do not write to the database; that is the job of
 * services/normalization and services/ingestion respectively. Keeping providers
 * dumb is what makes a new merchant a small, testable addition.
 *
 * Phase 1 status: no live merchant feed has been contracted, so the only
 * implementation is `SeedMerchantProvider`. See docs/product-data.md for what is
 * required to add a real one.
 */

/** A product exactly as a merchant describes it, before any Bloom processing. */
export interface RawMerchantProduct {
  /** The merchant's own stable identifier for this listing. Required. */
  externalId: string
  title: string
  description?: string
  brand?: string

  /** The merchant's own category string, in whatever vocabulary they use. */
  category?: string
  subcategory?: string
  gender?: string

  /** Price in major units (e.g. dollars). Strings are accepted and parsed. */
  price: number | string
  /** List/was price, if the merchant publishes one. Frequently unreliable. */
  originalPrice?: number | string | null
  currency?: string

  availability?: string
  productUrl: string
  imageUrl?: string
  images?: string[]

  /** Free-form merchant attributes: colour, size, material, fit, model, … */
  attributes?: Record<string, unknown>

  /** Per-variant rows, when the merchant separates them. */
  variants?: RawMerchantVariant[]

  /** Anything else the merchant sent, retained for debugging. */
  raw?: Record<string, unknown>
}

export interface RawMerchantVariant {
  sku?: string
  size?: string
  color?: string
  availability?: string
  attributes?: Record<string, unknown>
}

export interface RawPrice {
  externalId: string
  price: number | string
  originalPrice?: number | string | null
  currency?: string
  observedAt?: Date | string
}

export interface RawAvailability {
  externalId: string
  availability: string
}

/** Identity and redirect configuration for the merchant behind a provider. */
export interface MerchantDescriptor {
  name: string
  slug: string
  websiteUrl: string
  logoUrl?: string
  /**
   * Hostnames this merchant is permitted to receive redirects on. Enforced at
   * click time so a compromised or malformed feed cannot turn Bloom into an
   * open redirect.
   */
  allowedHosts: string[]
}

export interface ProductPage {
  products: RawMerchantProduct[]
  /** Opaque cursor for the next page, or null when the feed is exhausted. */
  cursor: string | null
}

export interface GetProductsOptions {
  cursor?: string | null
  limit?: number
  /** Only return products changed since this time, when the source supports it. */
  updatedSince?: Date
}

export interface MerchantProvider {
  /** Stable identifier for this provider implementation. */
  readonly id: string

  /** The merchant this provider supplies data for. */
  descriptor(): MerchantDescriptor

  /** Page through the merchant's catalogue. */
  getProducts(options?: GetProductsOptions): Promise<ProductPage>

  /** Fetch a single product by the merchant's own id, or null if it is gone. */
  getProduct(externalId: string): Promise<RawMerchantProduct | null>

  /** Current prices. Separated from getProducts because prices are re-polled far more often. */
  getPrices(externalIds: string[]): Promise<RawPrice[]>

  /** Current availability. */
  getAvailability(externalIds: string[]): Promise<RawAvailability[]>

  /**
   * Turn a product URL into a trackable affiliate URL.
   *
   * Returns null when the merchant has no affiliate programme configured, in
   * which case Bloom sends the user to the plain product URL and records the
   * click for its own analytics.
   */
  getAffiliateUrl(product: RawMerchantProduct, context: AffiliateContext): Promise<string | null>
}

export interface AffiliateContext {
  /** Bloom's own click id, so a merchant postback can be tied back to a click row. */
  clickId: string
  userId?: string | null
}
