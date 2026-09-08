import { canonicalizeTitle, slugify } from './vocabulary'

/**
 * Product identity.
 *
 * Two merchants listing the same physical product must resolve to one canonical
 * product; two different products must never collapse into one. The second
 * failure is much worse than the first — a user shown "3 merchants" for products
 * that are not actually the same is being actively misinformed about price — so
 * every rule here is an exact match on a deterministic key. There is no fuzzy
 * matching, no embedding similarity, and no model call.
 *
 * The key is stored on `products.match_key` with a unique constraint, so the
 * database itself enforces one row per identity.
 */

export type MatchConfidence = 'high' | 'medium'

export interface MatchKeyInput {
  brand: string
  title: string
  /** GTIN / EAN / UPC / ISBN, if the merchant supplies one. */
  gtin?: string | null
  /** Manufacturer part number or model code. */
  mpn?: string | null
}

export type MatchKeyResult =
  | { ok: true; key: string; strategy: 'gtin' | 'mpn' | 'title'; confidence: MatchConfidence }
  | { ok: false; reason: string }

/**
 * Validate a GTIN-8/12/13/14 using the standard mod-10 check digit.
 *
 * Worth doing: a mistyped or truncated barcode that still passes a length check
 * would merge two unrelated products under one identity.
 */
export function isValidGtin(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (![8, 12, 13, 14].includes(digits.length)) return false
  if (/^0+$/.test(digits)) return false

  const body = digits.slice(0, -1)
  const checkDigit = Number(digits.at(-1))

  // Weights alternate 3,1 from the rightmost body digit leftwards.
  let sum = 0
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight
  }

  return (10 - (sum % 10)) % 10 === checkDigit
}

/** Normalise a model/part number: alphanumerics only, upper-cased. */
export function normalizeMpn(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

/**
 * Build the identity key for a product.
 *
 * Strategies in descending order of trustworthiness. The strategy name is part
 * of the key, so a product identified by GTIN can never accidentally collide
 * with one identified by title.
 */
export function buildMatchKey(input: MatchKeyInput): MatchKeyResult {
  const brand = slugify(input.brand ?? '')
  if (!brand) return { ok: false, reason: 'brand is required for product identity' }

  // 1. A valid GTIN is globally unique and brand-independent.
  if (input.gtin) {
    const digits = String(input.gtin).replace(/\D/g, '')
    if (isValidGtin(digits)) {
      return { ok: true, key: `gtin:${digits}`, strategy: 'gtin', confidence: 'high' }
    }
    // An invalid GTIN is not a reason to reject the product, only to distrust
    // that one field and fall through to a weaker strategy.
  }

  // 2. Brand + manufacturer part number.
  if (input.mpn) {
    const mpn = normalizeMpn(String(input.mpn))
    // Very short codes ("S", "01") are not distinctive enough to merge on.
    if (mpn.length >= 4) {
      return { ok: true, key: `mpn:${brand}:${mpn}`, strategy: 'mpn', confidence: 'high' }
    }
  }

  // 3. Brand + canonicalised title. Medium confidence: good enough to merge two
  //    listings of "Aera Boxy Cotton T-Shirt", not good enough to be relied on
  //    across brands, which is why brand is part of the key.
  const title = canonicalizeTitle(input.title ?? '', input.brand)
  if (!title || title.length < 3) {
    return { ok: false, reason: 'title is too short to establish identity' }
  }

  return {
    ok: true,
    key: `title:${brand}:${slugify(title)}`,
    strategy: 'title',
    confidence: 'medium',
  }
}

/**
 * Extract a GTIN from arbitrary merchant attribute keys.
 *
 * Feeds use gtin / ean / upc / barcode / isbn interchangeably.
 */
export function findGtin(attributes: Record<string, unknown> | undefined): string | null {
  if (!attributes) return null
  const keys = ['gtin', 'gtin13', 'gtin12', 'ean', 'ean13', 'upc', 'barcode', 'isbn']
  for (const [key, value] of Object.entries(attributes)) {
    if (!keys.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue
    if (typeof value === 'string' || typeof value === 'number') {
      const digits = String(value).replace(/\D/g, '')
      if (digits) return digits
    }
  }
  return null
}

/**
 * Extract a model / part number from arbitrary merchant attribute keys.
 *
 * Note what is NOT accepted here: a bare `style` key. Many feeds use `style` for
 * an aesthetic descriptor ("minimal", "sporty"), and treating that as a part
 * number merges every product from a brand that shares a style into a single
 * canonical product. `styleCode` / `styleNumber` are genuine identifiers and are
 * accepted; `style` alone is not.
 */
export function findMpn(attributes: Record<string, unknown> | undefined): string | null {
  if (!attributes) return null
  const keys = [
    'mpn',
    'model',
    'modelnumber',
    'modelno',
    'partnumber',
    'partno',
    'stylecode',
    'stylenumber',
    'styleno',
  ]
  for (const [key, value] of Object.entries(attributes)) {
    if (!keys.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim()
      if (text) return text
    }
  }
  return null
}
