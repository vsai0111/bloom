import type {
  AffiliateContext,
  GetProductsOptions,
  MerchantDescriptor,
  MerchantProvider,
  ProductPage,
  RawAvailability,
  RawMerchantProduct,
  RawPrice,
} from '@/lib/merchants/provider'
import { SEED_PRODUCTS, type SeedMerchant, type SeedProduct } from '@/supabase/seed/catalog'
import { generatePriceSeries, retailRound } from '@/services/pricing/history'
import { createRng } from '@/lib/utils/random'
import { slugify } from '@/services/normalization/vocabulary'

/**
 * A MerchantProvider backed by the local seed catalogue.
 *
 * This exists so Bloom can be built, tested and demonstrated end to end without
 * a merchant integration — see docs/product-data.md for what swapping in a real
 * feed involves. It is a full implementation of the interface, not a stub:
 * it paginates, it returns messy field shapes on purpose (mixed casing, string
 * prices, merchant-specific category words) so the normalization layer is
 * genuinely exercised rather than being fed pre-cleaned data.
 */
export class SeedMerchantProvider implements MerchantProvider {
  readonly id: string

  private readonly merchant: SeedMerchant
  private readonly products: SeedProduct[]
  private readonly now: Date

  constructor(merchant: SeedMerchant, options: { now?: Date } = {}) {
    this.merchant = merchant
    this.id = `seed:${merchant.slug}`
    this.now = options.now ?? new Date()
    this.products = SEED_PRODUCTS.filter(
      (product) => !product.merchants || product.merchants.includes(merchant.slug),
    ).filter((product) => this.stocks(product))
  }

  /**
   * Not every merchant carries every product — otherwise every product would
   * show three identical offers and the comparison would be meaningless.
   */
  private stocks(product: SeedProduct): boolean {
    const rng = createRng(`stock:${this.merchant.slug}:${product.brand}:${product.title}`)
    return rng.chance(0.72)
  }

  descriptor(): MerchantDescriptor {
    return {
      name: this.merchant.name,
      slug: this.merchant.slug,
      websiteUrl: this.merchant.websiteUrl,
      allowedHosts: this.merchant.allowedHosts,
    }
  }

  private externalId(product: SeedProduct): string {
    return `${this.merchant.slug.toUpperCase().replace(/-/g, '')}-${slugify(`${product.brand} ${product.title}`).toUpperCase()}`.slice(
      0,
      64,
    )
  }

  /** The listing's undiscounted price at this merchant. */
  private listPrice(product: SeedProduct): number {
    return retailRound(
      product.basePrice * this.merchant.priceFactor,
      `${this.merchant.slug}:${product.title}`,
    )
  }

  private priceSeries(product: SeedProduct) {
    return generatePriceSeries({
      seed: `price:${this.merchant.slug}:${product.brand}:${product.title}`,
      listPrice: this.listPrice(product),
      discountRate: this.merchant.discountRate,
      now: this.now,
    })
  }

  private toRaw(product: SeedProduct): RawMerchantProduct {
    const externalId = this.externalId(product)
    const series = this.priceSeries(product)
    const rng = createRng(`raw:${this.merchant.slug}:${externalId}`)

    // Deliberately inconsistent shapes, mirroring how real feeds differ from
    // each other: one merchant sends numeric prices, another sends strings with
    // symbols; category vocabulary differs per merchant.
    const priceAsString = this.merchant.slug === 'meridian-goods'

    const availability = rng.chance(0.88)
      ? 'in stock'
      : rng.chance(0.6)
        ? 'Low Stock'
        : 'out of stock'

    return {
      externalId,
      // Merchants prefix their own titles with the brand and add noise.
      title: `${product.brand} ${product.title}${rng.chance(0.2) ? ' - NEW' : ''}`,
      description: product.description,
      brand: product.brand,
      category: this.merchantCategoryWord(product.category),
      subcategory: product.subcategory,
      gender: product.gender,
      price: priceAsString ? `$${series.currentPrice.toFixed(2)}` : series.currentPrice,
      originalPrice: series.originalPrice,
      currency: 'USD',
      availability,
      productUrl: `${this.merchant.websiteUrl}/p/${slugify(`${product.brand} ${product.title}`)}`,
      imageUrl: `/api/product-image/${slugify(`${product.brand}-${product.title}`)}`,
      attributes: {
        // Key casing varies per merchant on purpose.
        ...(this.merchant.slug === 'lark-store'
          ? { Colour: product.color, Fabric: product.material }
          : { color: product.color, material: product.material }),
        fit: product.fit,
        style: product.style,
        ...(product.gtin ? { ean13: product.gtin } : {}),
        ...(product.mpn ? { model: product.mpn } : {}),
      },
      variants: (product.sizes ?? []).map((size) => ({
        sku: `${externalId}-${size}`,
        size,
        color: product.color,
        availability,
      })),
      raw: { source: 'seed', merchant: this.merchant.slug },
    }
  }

  /** Each merchant describes categories in its own words. */
  private merchantCategoryWord(category: string): string {
    const vocab: Record<string, Record<string, string>> = {
      'northwind-supply': {
        clothing: 'Apparel',
        shoes: 'Footwear',
        accessories: 'Accessories',
        home: 'Home & Living',
        electronics: 'Tech',
      },
      'meridian-goods': {
        clothing: 'Women > Clothing',
        shoes: 'Shoes',
        accessories: 'Bags & Accessories',
        home: 'Homeware',
        electronics: 'Electronics',
      },
      'lark-store': {
        clothing: 'Ready to Wear',
        shoes: 'Sneakers & Boots',
        accessories: 'Jewellery & Accessories',
        home: 'Home Decor',
        electronics: 'Audio',
      },
    }
    return vocab[this.merchant.slug]?.[category] ?? category
  }

  async getProducts(options: GetProductsOptions = {}): Promise<ProductPage> {
    const limit = options.limit ?? 25
    const offset = options.cursor ? Number(options.cursor) : 0
    const slice = this.products.slice(offset, offset + limit)
    const nextOffset = offset + slice.length

    return {
      products: slice.map((product) => this.toRaw(product)),
      cursor: nextOffset < this.products.length ? String(nextOffset) : null,
    }
  }

  async getProduct(externalId: string): Promise<RawMerchantProduct | null> {
    const product = this.products.find((candidate) => this.externalId(candidate) === externalId)
    return product ? this.toRaw(product) : null
  }

  async getPrices(externalIds: string[]): Promise<RawPrice[]> {
    return externalIds.flatMap((externalId) => {
      const product = this.products.find((candidate) => this.externalId(candidate) === externalId)
      if (!product) return []
      const series = this.priceSeries(product)
      return [
        {
          externalId,
          price: series.currentPrice,
          originalPrice: series.originalPrice,
          currency: 'USD',
          observedAt: this.now,
        },
      ]
    })
  }

  async getAvailability(externalIds: string[]): Promise<RawAvailability[]> {
    return externalIds.flatMap((externalId) => {
      const product = this.products.find((candidate) => this.externalId(candidate) === externalId)
      if (!product) return []
      return [{ externalId, availability: String(this.toRaw(product).availability) }]
    })
  }

  /**
   * The seed merchants are fictional and have no affiliate programme, so this
   * returns null rather than inventing a tracking URL. Bloom then links to the
   * plain product URL and still records the click for its own analytics — the
   * same path a real merchant without an affiliate programme would take.
   */
  async getAffiliateUrl(_product: RawMerchantProduct, _context: AffiliateContext): Promise<null> {
    return null
  }

  /**
   * Full generated price history for a listing.
   *
   * Not part of the MerchantProvider interface: real merchants do not expose
   * history, Bloom accumulates it by polling. Seeding uses this to backfill so
   * the deal engine has something to work with on day one.
   */
  historyFor(externalId: string): Array<{ price: number; recordedAt: Date }> {
    const product = this.products.find((candidate) => this.externalId(candidate) === externalId)
    if (!product) return []
    return this.priceSeries(product).points
  }
}
