import type { Availability, Category, Gender } from '@/config/taxonomy'
import { isCategory } from '@/config/taxonomy'
import type { RawMerchantProduct, RawMerchantVariant } from '@/lib/merchants/provider'
import { isSafeHttpUrl } from '@/lib/utils/url'
import { buildMatchKey, findGtin, findMpn } from './matching'
import { discountFraction, normalizeCurrency, parsePrice, validateOriginalPrice } from './price'
import {
  canonicalizeTitle,
  displayTitle,
  mapAvailability,
  mapCategory,
  mapColor,
  mapFit,
  mapGender,
  mapMaterial,
  mapStyle,
  mapSubcategory,
  normalizeText,
} from './vocabulary'

/**
 * Raw merchant data -> canonical Bloom product.
 *
 * The contract: this function either returns a product that is safe to persist
 * and display, or it refuses with reasons. It never returns a partially-trusted
 * product, and it never invents a value it could not derive. Warnings record
 * fields that were dropped, so ingestion can report feed quality rather than
 * silently degrading.
 */

export interface NormalizedVariant {
  sku: string | null
  size: string | null
  color: string | null
  variantAttributes: Record<string, string>
}

export interface NormalizedListing {
  externalProductId: string
  title: string
  productUrl: string
  imageUrl: string | null
  availability: Availability
  currentPrice: number
  originalPrice: number | null
  currency: string
  /** Derived, never taken from the feed. */
  discountFraction: number | null
}

export interface NormalizedProduct {
  canonicalTitle: string
  description: string | null
  brand: string
  category: Category
  subcategory: string | null
  gender: Gender | null
  attributes: Record<string, string>
  /** Flattened attribute values, for full-text search. */
  keywords: string
  matchKey: string
  matchStrategy: 'gtin' | 'mpn' | 'title'
  listing: NormalizedListing
  variants: NormalizedVariant[]
  images: string[]
}

export type NormalizationOutcome =
  | { ok: true; value: NormalizedProduct; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] }

export interface NormalizationContext {
  defaultCurrency?: string
}

/** Case-insensitive attribute lookup across the messy keys feeds actually use. */
function attr(source: Record<string, unknown> | undefined, ...names: string[]): string | null {
  if (!source) return null
  const wanted = names.map((n) => n.toLowerCase().replace(/[^a-z0-9]/g, ''))
  for (const [key, value] of Object.entries(source)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!wanted.includes(normalizedKey)) continue
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return null
}

export function normalizeProduct(
  raw: RawMerchantProduct,
  context: NormalizationContext = {},
): NormalizationOutcome {
  const errors: string[] = []
  const warnings: string[] = []

  // --- Required identifiers -------------------------------------------------
  const externalProductId = typeof raw.externalId === 'string' ? raw.externalId.trim() : ''
  if (!externalProductId) errors.push('externalId is required')

  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) errors.push('title is required')

  // --- URLs (untrusted) -----------------------------------------------------
  if (!isSafeHttpUrl(raw.productUrl)) {
    errors.push('productUrl must be an absolute http(s) URL')
  }

  const candidateImages = [raw.imageUrl, ...(raw.images ?? [])].filter(
    (value): value is string => typeof value === 'string',
  )
  const images = candidateImages.filter((url) => {
    if (isSafeHttpUrl(url) || url.startsWith('/')) return true
    warnings.push(`dropped unsafe image url: ${url.slice(0, 80)}`)
    return false
  })

  // --- Brand ----------------------------------------------------------------
  // Required: brand anchors product identity, and guessing it from the title
  // would merge unrelated products. A feed without brands needs a mapping, not
  // an inference.
  const brand = (raw.brand ?? attr(raw.attributes, 'brand', 'manufacturer', 'vendor') ?? '').trim()
  if (!brand) errors.push('brand is required and could not be determined')

  // --- Category -------------------------------------------------------------
  const titleText = normalizeText(title)
  let category = mapCategory(raw.category)
  if (!category) category = mapCategory(raw.subcategory)
  if (!category) category = inferCategoryFromTitle(titleText)
  if (!category) {
    errors.push(
      `category could not be mapped to Bloom's taxonomy (merchant sent: ${String(raw.category ?? 'nothing')})`,
    )
  }

  // --- Price ----------------------------------------------------------------
  const currency = normalizeCurrency(raw.currency, context.defaultCurrency ?? 'USD')
  const parsedPrice = parsePrice(raw.price)
  if (!parsedPrice.ok) errors.push(`price is unusable: ${parsedPrice.reason}`)

  let originalPrice: number | null = null
  if (raw.originalPrice !== undefined && raw.originalPrice !== null && raw.originalPrice !== '') {
    const parsedOriginal = parsePrice(raw.originalPrice)
    if (!parsedOriginal.ok) {
      warnings.push(`original price discarded: ${parsedOriginal.reason}`)
    } else if (parsedPrice.ok) {
      const checked = validateOriginalPrice(parsedPrice.amount, parsedOriginal.amount)
      originalPrice = checked.original
      if (checked.warning) warnings.push(checked.warning)
    }
  }

  if (errors.length > 0 || !category || !parsedPrice.ok) {
    return { ok: false, errors, warnings }
  }

  // --- Descriptive attributes ----------------------------------------------
  const description = typeof raw.description === 'string' ? raw.description.trim() || null : null
  const searchable = `${titleText} ${normalizeText(description ?? '')}`

  const attributes: Record<string, string> = {}
  const color = mapColor(attr(raw.attributes, 'color', 'colour', 'shade')) ?? mapColor(titleText)
  const material =
    mapMaterial(attr(raw.attributes, 'material', 'fabric', 'composition')) ??
    mapMaterial(searchable)
  const fit = mapFit(attr(raw.attributes, 'fit', 'cut', 'silhouette')) ?? mapFit(searchable)
  const style =
    mapStyle(attr(raw.attributes, 'style', 'aesthetic', 'occasion')) ?? mapStyle(searchable)

  if (color) attributes.color = color
  if (material) attributes.material = material
  if (fit) attributes.fit = fit
  if (style) attributes.style = style

  const gender = mapGender(raw.gender) ?? mapGender(attr(raw.attributes, 'gender', 'department'))
  const subcategory = mapSubcategory(category, raw.subcategory, titleText)
  if (!subcategory) warnings.push('subcategory could not be determined')

  // --- Identity -------------------------------------------------------------
  const gtin = findGtin(raw.attributes ?? undefined)
  const mpn = findMpn(raw.attributes ?? undefined)
  const match = buildMatchKey({ brand, title, gtin, mpn })
  if (!match.ok) {
    return { ok: false, errors: [`product identity: ${match.reason}`], warnings }
  }

  // --- Variants -------------------------------------------------------------
  const variants = (raw.variants ?? [])
    .map((variant) => normalizeVariant(variant, warnings))
    .filter((variant): variant is NormalizedVariant => variant !== null)

  // --- Assemble -------------------------------------------------------------
  // Display title, not the identity string: `canonicalizeTitle` folds "T-Shirt"
  // into "tshirt" and strips colours, which is right for matching and wrong for
  // anything a user reads.
  const canonicalTitle = displayTitle(title, brand)

  const keywords = [
    ...Object.values(attributes),
    subcategory ?? '',
    gender ?? '',
    ...variants.map((v) => v.color ?? ''),
  ]
    .filter(Boolean)
    .join(' ')

  return {
    ok: true,
    warnings,
    value: {
      canonicalTitle,
      description,
      brand,
      category,
      subcategory,
      gender,
      attributes,
      keywords,
      matchKey: match.key,
      matchStrategy: match.strategy,
      variants,
      images,
      listing: {
        externalProductId,
        title,
        productUrl: String(raw.productUrl),
        imageUrl: images[0] ?? null,
        availability: mapAvailability(raw.availability),
        currentPrice: parsedPrice.amount,
        originalPrice,
        currency,
        discountFraction: discountFraction(parsedPrice.amount, originalPrice),
      },
    },
  }
}

function normalizeVariant(raw: RawMerchantVariant, warnings: string[]): NormalizedVariant | null {
  const size = typeof raw.size === 'string' ? raw.size.trim().toUpperCase() || null : null
  const color = mapColor(raw.color ?? null)

  if (raw.color && !color) warnings.push(`variant colour not recognised: ${String(raw.color)}`)
  if (!size && !color && !raw.sku) return null

  const variantAttributes: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw.attributes ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') {
      variantAttributes[key] = String(value)
    }
  }

  return {
    sku: typeof raw.sku === 'string' ? raw.sku.trim() || null : null,
    size,
    color,
    variantAttributes,
  }
}

/** Last-resort category inference from unmistakable product nouns. */
const CATEGORY_HINTS: Array<[Category, string[]]> = [
  [
    'shoes',
    ['sneaker', 'sneakers', 'boot', 'boots', 'loafer', 'loafers', 'sandal', 'sandals', 'trainers'],
  ],
  [
    'clothing',
    [
      'shirt',
      'tshirt',
      'dress',
      'jacket',
      'coat',
      'jeans',
      'trousers',
      'jumper',
      'knit',
      'skirt',
      'shorts',
    ],
  ],
  ['accessories', ['bag', 'belt', 'watch', 'sunglasses', 'scarf', 'wallet', 'tote']],
  ['electronics', ['headphones', 'earbuds', 'speaker', 'keyboard', 'camera', 'charger']],
  ['home', ['duvet', 'lamp', 'mug', 'cushion', 'pan', 'bedding', 'throw']],
]

function inferCategoryFromTitle(titleText: string): Category | null {
  for (const [category, hints] of CATEGORY_HINTS) {
    for (const hint of hints) {
      if (new RegExp(`(^| )${hint}( |$)`).test(titleText)) return category
    }
  }
  return null
}

export { isCategory }
